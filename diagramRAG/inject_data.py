import json
import chromadb
from sentence_transformers import SentenceTransformer
import os
import logging

# --- Configuration ---
SOURCE_JSON_FILE = 'bian_scraper/output.json' # Path to the Scrapy output file
CHROMA_DB_PATH = "./chroma_db_diagrams" # Directory to store ChromaDB data
COLLECTION_NAME = "bian_diagrams"
EMBEDDING_MODEL_NAME = 'all-MiniLM-L6-v2'

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- SVG Description Generation Function (from previous step) ---
def generate_svg_description(metadata, text_elements):
    """
    Generates a textual description for an SVG based on its metadata and text.
    (Initial version - can be refined later)
    """
    bizzid = metadata.get('bizzid', 'Unknown ID')
    concept = metadata.get('bizzconcept') # Might be None
    semantic = metadata.get('bizzsemantic') # Might be None
    description_parts = [f"BIAN Diagram ID {bizzid}."]
    if concept:
        description_parts.append(f"Primary Concept: {concept}.")
    if semantic:
        description_parts.append(f"Semantic Type: {semantic}.")
    if text_elements:
        key_texts = ", ".join(filter(None, text_elements[:15]))
        if key_texts:
             description_parts.append(f"Key elements mentioned: {key_texts}.")
    return " ".join(description_parts)

# --- Main Injection Logic ---
if __name__ == "__main__":
    logging.info("Starting data injection process...")

    # --- 1. Load Data from JSON ---
    if not os.path.exists(SOURCE_JSON_FILE):
        logging.error(f"Source JSON file not found: {SOURCE_JSON_FILE}")
        exit(1)

    try:
        with open(SOURCE_JSON_FILE, 'r', encoding='utf-8') as f:
            # Handle potential empty file or invalid JSON lines if scrapy output wasn't perfect JSON array
            content = f.read()
            # Scrapy output per line might not be a valid top-level array, need to wrap and fix
            if not content.strip().startswith('['):
                 content = '[' + content.replace('][', ',') + ']' # Attempt to fix line-by-line json
            data = json.loads(content)

        logging.info(f"Successfully loaded {len(data)} items from {SOURCE_JSON_FILE}")
    except json.JSONDecodeError as e:
        logging.error(f"Error decoding JSON from {SOURCE_JSON_FILE}: {e}")
        # Try to load line by line if array parsing fails
        logging.info("Attempting to load JSON line by line...")
        data = []
        try:
            with open(SOURCE_JSON_FILE, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.strip(): # Skip empty lines
                        try:
                           data.append(json.loads(line))
                        except json.JSONDecodeError as line_e:
                           logging.warning(f"Skipping invalid JSON line: {line.strip()} - Error: {line_e}")
            logging.info(f"Successfully loaded {len(data)} items line by line.")
        except Exception as file_e:
             logging.error(f"Could not read or parse {SOURCE_JSON_FILE} line by line: {file_e}")
             exit(1)

    except Exception as e:
        logging.error(f"Failed to load or parse {SOURCE_JSON_FILE}: {e}")
        exit(1)

    if not data:
        logging.warning("No data loaded from JSON file. Exiting.")
        exit(0)

    # --- 2. Initialize Embedding Model ---
    try:
        logging.info(f"Loading embedding model: {EMBEDDING_MODEL_NAME}...")
        model = SentenceTransformer(EMBEDDING_MODEL_NAME)
        logging.info("Embedding model loaded successfully.")
    except Exception as e:
        logging.error(f"Failed to load embedding model: {e}")
        exit(1)

    # --- 3. Initialize ChromaDB ---
    try:
        logging.info(f"Initializing ChromaDB client at path: {CHROMA_DB_PATH}")
        # Use PersistentClient to store data on disk
        client = chromadb.PersistentClient(path=CHROMA_DB_PATH)

        # Get or create the collection
        logging.info(f"Getting or creating collection: {COLLECTION_NAME}")
        # Use get_or_create_collection for idempotency
        collection = client.get_or_create_collection(name=COLLECTION_NAME)
        logging.info(f"Using collection '{collection.name}' (ID: {collection.id})")

    except Exception as e:
        logging.error(f"Failed to initialize ChromaDB or collection: {e}")
        exit(1)

    # --- 4. Process and Inject Data ---
    logging.info("Processing data and preparing for injection...")
    ids_to_inject = []
    embeddings_to_inject = []
    metadatas_to_inject = []
    documents_to_inject = [] # ChromaDB uses 'documents' for the text that was embedded

    processed_count = 0
    skipped_count = 0
    for i, item in enumerate(data):
        try:
            # Basic validation
            if not all(k in item for k in ['source_url', 'svg_index', 'metadata', 'text_elements', 'svg_content']):
                logging.warning(f"Skipping item {i+1} due to missing required keys.")
                skipped_count += 1
                continue

            # Generate description
            description = generate_svg_description(item['metadata'], item['text_elements'])

            # Generate unique ID for ChromaDB
            # Combining source URL and SVG index should be unique
            chroma_id = f"{item['source_url']}#svg{item['svg_index']}"

            # Prepare metadata for ChromaDB (must be JSON serializable, basic types)
            chroma_metadata = {
                "source_url": item['source_url'],
                "svg_index": item['svg_index'],
                "bizzid": str(item['metadata'].get('bizzid', 'N/A')), # Ensure string
                "bizzconcept": item['metadata'].get('bizzconcept'), # Keep as None if missing
                "bizzsemantic": item['metadata'].get('bizzsemantic'), # Keep as None if missing
                # Store SVG content directly in metadata (ensure it's not excessively large)
                "svg_content": item['svg_content'],
                # Store original text elements (limited for sanity)
                "text_elements_preview": json.dumps(item['text_elements'][:10])
            }
            # Filter out None values from metadata before storing
            chroma_metadata = {k: v for k, v in chroma_metadata.items() if v is not None}


            # Add to lists for batch insertion
            ids_to_inject.append(chroma_id)
            # Embedding will be calculated in batch later
            metadatas_to_inject.append(chroma_metadata)
            documents_to_inject.append(description) # Store the description as the 'document'

            processed_count += 1
            if (i + 1) % 5 == 0: # Log progress every 5 items
                 logging.info(f"Prepared {i+1}/{len(data)} items for embedding...")

        except Exception as e:
            logging.warning(f"Skipping item {i+1} due to error during processing: {e}")
            skipped_count += 1
            continue

    logging.info(f"Finished preparing data. Processed: {processed_count}, Skipped: {skipped_count}.")

    # --- 5. Calculate Embeddings (Batch) ---
    if documents_to_inject:
        logging.info(f"Calculating embeddings for {len(documents_to_inject)} descriptions...")
        try:
            embeddings_to_inject = model.encode(documents_to_inject, show_progress_bar=True).tolist()
            logging.info("Embeddings calculated successfully.")

            # --- 6. Inject into ChromaDB (Batch) ---
            logging.info(f"Injecting {len(ids_to_inject)} items into ChromaDB collection '{COLLECTION_NAME}'...")
            try:
                # Use collection.add for potentially new items, or upsert if IDs might exist
                collection.upsert(
                    ids=ids_to_inject,
                    embeddings=embeddings_to_inject,
                    metadatas=metadatas_to_inject,
                    documents=documents_to_inject # Store the descriptions themselves
                )
                logging.info(f"Successfully injected/updated {collection.count()} items into the collection.")
            except Exception as e:
                logging.error(f"Error injecting data into ChromaDB: {e}")
                # Consider logging details of failed items if possible
                # logging.error(f"Failed IDs: {ids_to_inject[:10]}...")
                exit(1)

        except Exception as e:
            logging.error(f"Error calculating embeddings: {e}")
            exit(1)
    else:
        logging.info("No valid data processed, nothing to embed or inject.")


    logging.info("Data injection process finished.")
