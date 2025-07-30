import os
import glob

# Define base directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def get_latest_data_folder(base_dir):
    """Retrieve the most recent year folder for data files."""
    year_folders = glob.glob(os.path.join(base_dir, "20[0-9][0-9]"))  # Adjust the pattern if naming changes
    latest_folder = max(year_folders, key=os.path.getmtime)  # Get the most recently modified directory
    return latest_folder

# Use the latest data folder
LATEST_DATA_DIR = get_latest_data_folder(BASE_DIR)
LATEST_YEAR = os.path.basename(LATEST_DATA_DIR)  # Extracts the year from the folder name

# Define paths using the latest year folder and dynamic file names
EXPECTED_VALUES_PATH = os.path.join(LATEST_DATA_DIR, f'Standard_Auction_Values.csv')
MAPPINGS_PATH = os.path.join(LATEST_DATA_DIR, f'player_name_mappings.csv')

# Dynamic filenames that include the year in their names
file_paths = [
    f'player_name_mappings.csv',
    f'FantasyPros_{LATEST_YEAR}_Draft_QB_Rankings.csv',
    f'FantasyPros_{LATEST_YEAR}_Draft_RB_Rankings.csv',
    f'FantasyPros_{LATEST_YEAR}_Draft_WR_Rankings.csv',
    f'FantasyPros_{LATEST_YEAR}_Draft_TE_Rankings.csv',
    f'Standard_Auction_Values.csv'
]

for file_path in file_paths:
    full_path = os.path.join(LATEST_DATA_DIR, file_path)
    if os.path.exists(full_path):
        print(f"{full_path} exists!")
    else:
        print(f"{full_path} does not exist!")
