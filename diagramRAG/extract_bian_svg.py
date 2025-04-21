import requests
from bs4 import BeautifulSoup
from lxml import etree
import io

# --- Configuration ---
TARGET_URL = "https://bian.org/servicelandscape-12-0-0/object_21.html?object=35553"
# BIAN specific attributes to extract from the root <svg> tag
SVG_METADATA_ATTRIBUTES = ['bizzid', 'bizzsemantic', 'bizzconcept']
# Standard headers to mimic a browser
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

# --- Functions ---

def fetch_html(url: str) -> str | None:
    """Fetches HTML content from a given URL."""
    print(f"Attempting to fetch HTML from: {url}")
    try:
        response = requests.get(url, headers=HEADERS, timeout=20)
        response.raise_for_status()  # Raise an exception for bad status codes (4xx or 5xx)
        print(f"Successfully fetched HTML (Status Code: {response.status_code})")
        return response.text
    except requests.exceptions.RequestException as e:
        print(f"Error fetching URL {url}: {e}")
        return None

def find_svg_content(html_content: str) -> list[str]:
    """Finds all SVG tag content within the HTML."""
    print("Parsing HTML to find SVG elements...")
    soup = BeautifulSoup(html_content, 'lxml') # Use lxml parser for speed and robustness
    svg_tags = soup.find_all('svg')
    print(f"Found {len(svg_tags)} SVG element(s).")
    # Return the string representation of each SVG tag
    return [str(svg) for svg in svg_tags]

def extract_svg_data(svg_string: str) -> dict | None:
    """Parses a single SVG string and extracts metadata and text."""
    try:
        # lxml works best with bytes, especially if encoding is involved
        parser = etree.XMLParser(remove_blank_text=True)
        # Use io.BytesIO to handle the string as a file-like object of bytes
        svg_bytes = io.BytesIO(svg_string.encode('utf-8'))
        tree = etree.parse(svg_bytes, parser)
        root = tree.getroot()

        # Define the SVG namespace - essential for XPath queries
        ns = {'svg': 'http://www.w3.org/2000/svg'}

        extracted_data = {
            'metadata': {},
            'text_elements': []
        }

        # Extract specified metadata attributes from the root <svg> element
        for attr in SVG_METADATA_ATTRIBUTES:
            value = root.get(attr)
            if value:
                extracted_data['metadata'][attr] = value
            else:
                 extracted_data['metadata'][attr] = None # Indicate if attribute is missing


        # Extract text content from all <text> elements using XPath with namespace
        # This finds text directly within <text> and within its children like <tspan>
        text_nodes = root.xpath('.//svg:text//text()', namespaces=ns)
        extracted_data['text_elements'] = [text.strip() for text in text_nodes if text.strip()]

        return extracted_data

    except etree.XMLSyntaxError as e:
        print(f"Error parsing SVG XML: {e}")
        # Optionally print problematic part of SVG:
        # print(f"Problematic SVG snippet: {svg_string[:500]}...")
        return None
    except Exception as e:
        print(f"An unexpected error occurred during SVG parsing: {e}")
        return None


# --- Main Execution ---

if __name__ == "__main__":
    html = fetch_html(TARGET_URL)

    if html:
        svg_contents = find_svg_content(html)

        if not svg_contents:
            print("No SVG content found on the page.")
        else:
            print("\n--- Extracting Data from Found SVGs ---")
            for i, svg_str in enumerate(svg_contents):
                print(f"\nProcessing SVG #{i+1}...")
                data = extract_svg_data(svg_str)
                if data:
                    print("  Extracted Metadata:")
                    for key, value in data['metadata'].items():
                        print(f"    {key}: {value}")
                    print("  Extracted Text Elements:")
                    if data['text_elements']:
                        for text in data['text_elements']:
                            print(f"    - {text}")
                    else:
                        print("    (No text elements found)")
                else:
                    print("  Failed to extract data from this SVG.")

            print("\n--- Validation Script Finished ---")
