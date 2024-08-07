# Set the base directory where the script will operate
$baseDir = "C:\Users\lasab\Code\inflaction_calculator"

# Set the paths for the 2023 and 2024 folders
$folder2023 = Join-Path -Path $baseDir -ChildPath "2023"
$folder2024 = Join-Path -Path $baseDir -ChildPath "2024"

# Create the 2023 folder if it does not exist
if (-not (Test-Path -Path $folder2023)) {
    New-Item -ItemType Directory -Path $folder2023
    Write-Output "Created folder: $folder2023"
}

# Move all CSV files to the 2023 folder
Get-ChildItem -Path $baseDir -Filter *.csv | ForEach-Object {
    Move-Item -Path $_.FullName -Destination $folder2023
    Write-Output "Moved $($_.Name) to $folder2023"
}

# Create the 2024 folder if it does not exist
if (-not (Test-Path -Path $folder2024)) {
    New-Item -ItemType Directory -Path $folder2024
    Write-Output "Created folder: $folder2024"
}

Write-Output "Script completed."
