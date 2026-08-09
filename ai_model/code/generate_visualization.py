import csv
import math
import os
import sys

from PIL import Image


# Parse disk data from the csv
disk_data_csv = sys.argv[1]
disk_data = []

with open(disk_data_csv, newline='') as csvfile:
  reader = csv.DictReader(csvfile)

  for i, row in enumerate(reader):
    disk_data.append([])

    for j in range(50):
      bucket_data = {
        'r': row[f'r_avg_{j}'],
        'g': row[f'g_avg_{j}'],
        'b': row[f'b_avg_{j}'],
        'necrotic_percent': row[f'necrotic_percent_{j}'],
      }

      disk_data[i].append(bucket_data)

# Create the visualization
bucket_width = 20
bucket_height = 150
width = len(disk_data[0]) * bucket_width
height = len(disk_data) * bucket_height
png = Image.new('RGB', (width, height))

for row in range(height):
  for col in range(width):
    # Find which data to use
    bucket_i = math.floor(col / bucket_width)
    disk_i = math.floor(row / bucket_height)
    data = disk_data[disk_i][bucket_i]

    if row % bucket_height < bucket_height * 0.8:
      # Bucket color
      png.putpixel((col, row), (int(float(data['r'])), int(float(data['g'])), int(float(data['b']))))
    elif row % bucket_height < bucket_height * 0.95:
      # Necrotic percent
      if col % bucket_width < bucket_width * float(data['necrotic_percent']) / 100:
        png.putpixel((col, row), (255, 0, 0))
      else:
        png.putpixel((col, row), (0, 255, 0))
    else:
      # Dividing line
      png.putpixel((col, row), (0, 0, 0))

# Get the file name from the csv
base_file_name = os.path.basename(disk_data_csv)
file_name_no_ext = os.path.splitext(base_file_name)[0]

# Save the image
png.save(f'../visualizations/{file_name_no_ext}.png')
