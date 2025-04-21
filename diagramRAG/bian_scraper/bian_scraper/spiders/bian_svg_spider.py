import scrapy
from lxml import etree
from urllib.parse import urljoin, urlparse
import io
import logging # Import logging

# --- Configuration ---
# Use the URL that requires JS rendering
START_URL = "https://bian.org/servicelandscape-12-0-0/object_21.html?object=30437"
ALLOWED_DOMAIN = "bian.org"
# BIAN specific attributes to extract from the root <svg> tag
SVG_METADATA_ATTRIBUTES = ['bizzid', 'bizzsemantic', 'bizzconcept']
# Define the SVG namespace - essential for XPath queries
SVG_NS = {'svg': 'http://www.w3.org/2000/svg'}


class BianSvgSpider(scrapy.Spider):
    name = 'bian_svg'
    allowed_domains = [ALLOWED_DOMAIN]
    # We will generate initial requests in start_requests now

    # Remove start_urls here, we'll use start_requests instead
    # start_urls = [START_URL]

    # Custom settings moved to settings.py, but can be kept here too
    # custom_settings = { ... }

    def start_requests(self):
        """
        Generate initial requests using Playwright.
        """
        self.log(f"Generating initial Playwright request for: {START_URL}", level=logging.INFO)
        yield scrapy.Request(
            START_URL,
            meta={'playwright': True}, # <<< Tell Scrapy to use Playwright for this request
            callback=self.parse
            # Initial depth is implicitly 0
        )

    def parse(self, response):
        """
        Parses the page content (now rendered by Playwright).
        Extracts SVG data and follows internal HTML links.
        """
        # The response object now contains the HTML *after* JS execution
        self.log(f"Processing page (rendered by Playwright): {response.url}", level=logging.INFO)

        # --- Extract SVG Data ---
        # This XPath should now work on the JS-rendered content
        svg_elements = response.xpath('//svg')
        self.log(f"Found {len(svg_elements)} SVG element(s) on {response.url}", level=logging.INFO)

        if not svg_elements:
             self.log(f"No SVG elements found using XPath '//svg' on {response.url}", level=logging.WARNING)

        for i, svg_selector in enumerate(svg_elements):
            self.log(f"Processing SVG #{i+1} on {response.url}", level=logging.DEBUG)
            svg_string = svg_selector.get()
            self.log(f"Attempting to extract data from SVG #{i+1} (length: {len(svg_string)})", level=logging.DEBUG)
            svg_data = self.extract_svg_data(svg_string, response.url, i + 1)
            if svg_data:
                self.log(f"Successfully extracted data for SVG #{i+1}, yielding item.", level=logging.DEBUG)
                yield {
                    'source_url': response.url,
                    'svg_index': i + 1,
                    'metadata': svg_data['metadata'],
                    'text_elements': svg_data['text_elements'],
                    'svg_content': svg_string
                }
            else:
                 self.log(f"Failed to extract data from SVG #{i+1} on {response.url}. extract_svg_data returned None.", level=logging.WARNING)

        # --- Follow Links (Depth 1) ---
        # This XPath should also work on the JS-rendered content now
        current_depth = response.meta.get('depth', 0)
        self.log(f"Current depth: {current_depth}", level=logging.DEBUG)
        if current_depth < 1:
            self.log(f"Following links from {response.url} (depth < 1)", level=logging.DEBUG)
            links = response.xpath('//a/@href').getall()
            self.log(f"Found {len(links)} potential links: {links}", level=logging.DEBUG) # Check this log again
            followed_count = 0
            for link in links:
                absolute_url = urljoin(response.url, link)
                parsed_url = urlparse(absolute_url)

                if parsed_url.netloc == ALLOWED_DOMAIN and absolute_url.endswith('.html'):
                     self.log(f"Found valid internal HTML link to follow: {absolute_url}", level=logging.DEBUG)
                     followed_count += 1
                     # Also use Playwright for followed links
                     yield scrapy.Request(
                         absolute_url,
                         callback=self.parse,
                         meta={
                             'playwright': True, # <<< Use Playwright here too
                             'depth': current_depth + 1
                         }
                     )
            self.log(f"Finished checking links on {response.url}. Followed {followed_count} valid links.", level=logging.DEBUG)
        else:
             self.log(f"Not following links from {response.url} (depth limit reached)", level=logging.DEBUG)


    def extract_svg_data(self, svg_string: str, source_url: str, svg_index: int) -> dict | None:
        """Parses a single SVG string and extracts metadata and text using lxml."""
        self.log(f"[Extract Func] Parsing SVG #{svg_index} from {source_url}", level=logging.DEBUG)
        try:
            parser = etree.XMLParser(remove_blank_text=True, recover=True)
            svg_bytes = io.BytesIO(svg_string.encode('utf-8'))
            tree = etree.parse(svg_bytes, parser)
            root = tree.getroot()

            if root is None:
                self.log(f"[Extract Func] Failed to parse SVG #{svg_index}: Root element is None.", level=logging.WARNING)
                return None

            if '}' in root.tag:
                tag_local_name = root.tag.split('}', 1)[1]
            else:
                tag_local_name = root.tag

            if tag_local_name != 'svg':
                 self.log(f"[Extract Func] Parsed root element for SVG #{svg_index} is not SVG: <{root.tag}>. Skipping.", level=logging.WARNING)
                 return None

            self.log(f"[Extract Func] Root element is <{root.tag}>. Proceeding with extraction for SVG #{svg_index}.", level=logging.DEBUG)
            extracted_data = {'metadata': {}, 'text_elements': []}
            for attr in SVG_METADATA_ATTRIBUTES:
                attr_value = root.get(attr)
                extracted_data['metadata'][attr] = attr_value
                self.log(f"[Extract Func] SVG #{svg_index} Metadata '{attr}': {attr_value}", level=logging.DEBUG)

            text_nodes = root.xpath('.//svg:text//text()', namespaces=SVG_NS)
            extracted_data['text_elements'] = [text.strip() for text in text_nodes if text.strip()]
            self.log(f"[Extract Func] SVG #{svg_index} Found {len(extracted_data['text_elements'])} text elements.", level=logging.DEBUG)

            self.log(f"[Extract Func] Successfully parsed SVG #{svg_index}.", level=logging.DEBUG)
            return extracted_data
        except etree.XMLSyntaxError as e:
            self.log(f"[Extract Func] Error parsing SVG #{svg_index} XML: {e}. SVG snippet: {svg_string[:200]}...", level=logging.ERROR)
            return None
        except Exception as e:
            self.log(f"[Extract Func] An unexpected error occurred during SVG #{svg_index} parsing: {e}", level=logging.ERROR)
            return None 