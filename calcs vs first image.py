#!/usr/bin/env python3
# Usage: python calcs.py image1.png [image2.png ...]

import sys
import os
import math
import numpy as np
from PIL import Image
from skimage import io, color

# ============================================== #
# Utility functions (top-level, available everywhere)
# ============================================== #

# Determine if a number is within the given tolerance of another number
def is_within_tolerance(correct_num, num, tolerance):
  return abs(correct_num - num) < correct_num * tolerance

# Calculate the distance between two points
def point_distance(row1, col1, row2, col2):
  return math.sqrt((row1 - row2)**2 + (col1 - col2)**2)

# Checks if a number is a real number
def is_real_number(num):
  if not isinstance(num, (int, float)):
    return False
  if isinstance(num, float):
    return not (math.isnan(num) or math.isinf(num))
  return True

# Sum up all the values in the array, ignoring non-numbers
def sum_real(arr):
  return sum(v for v in arr if is_real_number(v))

# Find the largest cluster
def clustered_mode(arr, tolerance):
  tolerance = tolerance
  max_val = int(max(arr) + tolerance)
  counts = [0] * (max_val + 1)

  for val in arr:
    for i in range(int(val - tolerance), int(val + tolerance + 1)):
      if 0 <= i <= max_val:
        counts[i] += 1

  max_count = max(counts)
  matching_indices = [i for i, c in enumerate(counts) if c == max_count]

  return average(matching_indices)

# Average an array of numbers
def average(arr):
  real = [v for v in arr if is_real_number(v)]

  return 0 if not real else sum(real) / len(real)

# Get the average color for a block of pixels, inclusive
def avg_color(pixels, top, bottom, left, right):
  r_total = 0
  g_total = 0
  b_total = 0

  for row in range(top, bottom + 1):
    for col in range(left, right + 1):
      r_total += pixels[row][col]['r']
      g_total += pixels[row][col]['g']
      b_total += pixels[row][col]['b']

  num_pixels = (bottom - top + 1) * (right - left + 1)

  return {
    'r': r_total / num_pixels,
    'g': g_total / num_pixels,
    'b': b_total / num_pixels
  }

# https://stackoverflow.com/questions/65987106/how-do-i-calculate-r-squared-value-in-javascript
def r_squared(data, coefficients):
  y_pred = lambda x: coefficients['slope'] * x + coefficients['y_intercept']
  y_mean = sum(p['y'] for p in data) / len(data)
  regression_sq_err = sum((p['y'] - y_pred(p['x']))**2 for p in data)
  total_sq_err = sum((p['y'] - y_mean)**2 for p in data)

  return 1 - (regression_sq_err / total_sq_err) if total_sq_err != 0 else 0

# Calculate linear regression https://codeforgeek.com/linear-regression-in-javascript/
# x is the index, and y is the value of the data at the index
def linear_regression(data):
  xmean = sum(p['x'] for p in data) / len(data)
  ymean = sum(p['y'] for p in data) / len(data)

  num = 0
  denom = 0

  for p in data:
    num += (p['x'] - xmean) * (p['y'] - ymean)
    denom += (p['x'] - xmean)**2

  slope = num / denom if denom != 0 else 0
  y_intercept = ymean - slope * xmean
  coefficients = {'slope': slope, 'y_intercept': y_intercept}
  coefficients['r_squared'] = r_squared(data, coefficients)

  return coefficients

# Add the pixel to the list of blobs
# optionally provide a function to determine if it is a match
def add_pixel_to_blobs(row, col, rgb, lab, blobs, is_match=None):
  indices = find_touching_blob_indices(row, col, blobs, is_match)

  if len(indices) == 0:
    # If there are no matches, create a new blob
    matching_blob = PixelBlob()
    blobs.append(matching_blob)
  elif len(indices) == 1:
    # If there is only one match use that
    matching_blob = blobs[indices[0]]
  else:
    # If there are two or more matches, merge them
    matching_blob = blobs[indices[0]]

    # Reverse the list so that popping doesn't invalidate the indicies
    for i in reversed(indices[1:]):
      matching_blob.merge(blobs[i])
      blobs.pop(i)

  matching_blob.add_pixel(row, col, rgb, lab)

# Return a sorted array of indices of all blobs that touch the given pixel
def find_touching_blob_indices(row, col, blobs, is_match):
  indices = []

  for i, blob in enumerate(blobs):
    if blob.touches(row, col) and (is_match is None or is_match(blob)):
      indices.append(i)

  return indices

# Group blobs into sorted rows
def group_blobs_into_rows(blobs):
  rows = []

  for blob in blobs:
    assigned = False

    # Try to find a row that it matches
    for i, row in enumerate(rows):
      mid = blob.center_coordinates['center_row']

      if not assigned and row[0].top < mid < row[0].bottom:
        assigned = True
        blob.row_group = i
        row.append(blob)

    # Otherwise, create a new row
    if not assigned:
      blob.row_group = len(rows)
      rows.append([blob])

  # Sort the leaf disk blobs within each row, left to right
  for row in rows:
    row.sort(key=lambda b: b.left)

  return rows

# Return the ratio of the difference between the observed and reference values
def value_error(observed, reference):
  return abs(observed - reference) / reference

# Flatten 2D array of pixels to 1D array and
# convert RGB dicts to an array ordered R, G, B
# Result is a 2d array
def pixels_to_rgb_array(pixels):
  result = []

  for row in pixels:
    result.extend([[p['r'], p['g'], p['b']] for p in row])

  return result

# Convert list of RGB arrays back to a 2D array of pixel RGB dicts
def rgb_array_to_pixels(rgb_array, num_rows, num_cols):
  assert num_rows * num_cols == len(rgb_array), 'Incorrect number of pixels'

  # Convert each pixel into a dict
  rgb_dicts = [{'r': rgb[0], 'g': rgb[1], 'b': rgb[2]} for rgb in rgb_array]

  # Convert into 2D array of pixels
  return [rgb_dicts[i * num_cols:(i + 1) * num_cols] for i in range(num_rows)]

# Write the given file
def write_file(path, contents):
  with open(path, 'w') as f:
    f.write(contents)

# ============================================== #
# PixelBlob class
# Handles a single blob of pixels
# ============================================== #

class PixelBlob:
  def __init__(self):
    # Initialize borders to +/- infinity so that they will be overwritten when a pixel is added
    self.top    = float('inf')
    self.bottom = float('-inf')
    self.left   = float('inf')
    self.right  = float('-inf')
    self.pixel_data = []
    self.row_group = None
    self.avg_color = {}
    self.color_deviation = None

  @property
  def height(self):
    return self.bottom - self.top

  @property
  def width(self):
    return self.right - self.left

  @property
  def center_coordinates(self):
    return {
      'center_row': (self.bottom + self.top) / 2,
      'center_col': (self.right + self.left) / 2
    }

  @property
  def radius(self):
    return (self.height + self.width) / 4

  def boundaries(self):
    return {
      'top': self.top,
      'bottom': self.bottom,
      'left': self.left,
      'right': self.right
    }

  # Returns true if the coordinates are contained by or adjacent to the blob
  def touches(self, row, col):
    return (self.top - 1) <= row <= (self.bottom + 1) and (self.left - 1) <= col <= (self.right + 1)

  # Adjust the boundaries if necessary and add the coordinates to the array
  def add_pixel(self, row, col, rgb, lab):
    if self.top > row: self.top = row
    if self.bottom < row: self.bottom = row
    if self.left > col: self.left = col
    if self.right < col: self.right = col

    self.pixel_data.append({
      'row': row,
      'col': col,
      'rgb': {'r': int(rgb[0]), 'g': int(rgb[1]), 'b': int(rgb[2])},
      'lab': {'l': int(lab[0]), 'a': int(lab[1]), 'b': int(lab[2])}
    })

  # Merge the blob into this one
  def merge(self, blob):
    self.top    = min(self.top,    blob.top)
    self.bottom = max(self.bottom, blob.bottom)
    self.left   = min(self.left,   blob.left)
    self.right  = max(self.right,  blob.right)

    self.pixel_data.extend(blob.pixel_data)

  # Returns true if the blob's height and width are roughly equal,
  # it has roughly the number of dark pixels expected if it were circular,
  # and the radius is greater than 62 (the image shouldn't be less than 200 dpi, leaf disk radius is 5/16")
  def is_leaf_disk(self):
    is_square = is_within_tolerance(self.height, self.width, 0.1)
    expected_pixels = math.pi * (self.radius**2)
    is_correct_pixel_count = is_within_tolerance(expected_pixels, len(self.pixel_data), 0.1)
    is_large_enough = self.radius > 62

    return is_square and is_correct_pixel_count and is_large_enough
    # return self.height > 100 and self.width > 100 and len(self.pixel_data) < self.height*self.width*0.8

  # Set the average color of the whole disk
  def set_avg_color(self):
    count = len(self.pixel_data)
    totals = {'r': 0, 'g': 0, 'b': 0}

    for data in self.pixel_data:
      for color in ['r', 'g', 'b']:
        totals[color] += data['rgb'][color]

    self.avg_color = {
      'r': totals['r']/count,
      'g': totals['g']/count,
      'b': totals['b']/count
    }

  # Standard deviations for all pixel scoring methods
  def set_standard_deviations(self):
    self.aggregates['live']['standard_deviation'] = {
      'rgb': {},
      'lab': {}
    }
    self.aggregates['necrotic']['standard_deviation'] = {
      'rgb': {},
      'lab': {}
    }

    rgb_keys = self.aggregates['live']['average']['rgb'].keys()
    lab_keys = self.aggregates['live']['average']['lab'].keys()

    for key in rgb_keys:
      self.aggregates['live']['standard_deviation']['rgb'][key] = self.standard_deviation(True, 'rgb', key)
      self.aggregates['necrotic']['standard_deviation']['rgb'][key] = self.standard_deviation(False, 'rgb', key)

    for key in lab_keys:
      self.aggregates['live']['standard_deviation']['lab'][key] = self.standard_deviation(True, 'lab', key)
      self.aggregates['necrotic']['standard_deviation']['lab'][key] = self.standard_deviation(False, 'lab', key)

  # Calculate standard deviation
  def standard_deviation(self, is_live, color_space, key):
    all_data = list(filter(lambda d: d['is_live'] == is_live, self.pixel_data))
    values = list(map(lambda d: d['raw'][color_space][key], all_data))
    avg = self.aggregates['live']['average'][color_space][key]
    deviation_sum = sum(list(map(lambda x: (x - avg) ** 2, values)))

    return math.sqrt(deviation_sum/len(values))

  # Get the color deviation for the blob vs the reference color, based on standard deviation
  def set_color_deviation(self, ref_color):
    deviation_sum = 0
    count = len(self.pixel_data)

    for data in self.pixel_data:
      for color in ['r', 'g', 'b']:
        deviation_sum += (data['rgb'][color] - ref_color[color])**2

    # Divide by 3 for 3 colors
    self.color_deviation = math.sqrt((deviation_sum/3)/count)


# ============================================== #
# LeafDiskImage class
# Handles the entire image
# Finds leaf disks
# Does calculations
# ============================================== #

class LeafDiskImage:
  def __init__(self, file_path):
    self.file_path       = file_path
    self.rgb_image       = None
    self.lab_image       = None
    self.pixel_tags      = []
    self.dark_blobs      = []
    self.leaf_disk_blobs = []
    self.rows            = []
    self.reference_colors = []

  # Do all the image processing from loading the file to determining necrotic areas
  def process_image(self):
    # Load image (both RGB and Lab versions)
    self.load_image(self.file_path)

    # Find dark blobs
    for row, rgb_row in enumerate(self.rgb_image):
      for col, rgb in enumerate(rgb_row):
        # If pixel is dark, add it to blobs
        if int(rgb[0]) + int(rgb[1]) + int(rgb[2]) <= 500:
          add_pixel_to_blobs(row, col, rgb, self.lab_image[row][col], self.dark_blobs)

    # Set the leaf disk blobs and group them into rows
    self.leaf_disk_blobs = [b for b in self.dark_blobs if b.is_leaf_disk()]
    if len(self.leaf_disk_blobs) == 0:
      raise 'No leaf disks found'

    self.set_leaf_disk_rows()

    # Outline leaf disks for the highlighted image
    self.label_blob_borders()

  # Group the leaf disks into sorted rows
  def set_leaf_disk_rows(self):
    self.rows = []

    for blob in self.leaf_disk_blobs:
      assigned = False

      # Try to find a row that it matches
      for i, row in enumerate(self.rows):
        mid = blob.center_coordinates['center_row']

        if not assigned and row[0].top < mid < row[0].bottom:
          assigned = True
          blob.row_group = i
          row.append(blob)

      # Otherwise, create a new row
      if not assigned:
        blob.row_group = len(self.rows)
        self.rows.append([blob])

    # Sort the leaf disk blobs within each row, left to right
    for row in self.rows:
      row.sort(key=lambda b: b.left)

    self.label_row_groups()

  # Set the 2d array of reference colors, one for each blob
  def set_reference_colors(self):
    for blob in self.leaf_disk_blobs:
      blob.set_avg_color()

    for i, blobs in enumerate(self.rows):
      self.reference_colors[i] = list(map(lambda b: b.avg_color, blobs))

  # Set color deviations for all blobs in the image
  def set_color_deviations(self, ref_colors):
    for row, blobs in enumerate(self.rows):
      for col, blob in enumerate(blobs):
        blob.set_color_deviation(self.reference_colors[row][col])

  # Create a visualization
  def get_highlighted_image(self):
    height = len(self.pixel_tags)
    width  = len(self.pixel_tags[0])
    png    = Image.new('RGB', (width, height))

    for row in range(height):
      for col in range(width):
        pixel_rgb = self.rgb_image[row][col]
        tags = self.pixel_tags[row][col]
        r, g, b = pixel_rgb[0], pixel_rgb[1], pixel_rgb[2]

        # Mark leaf disk boxes and row markers black
        if tags.get('is_leaf_disk_box') or tags.get('is_row_marker'):
          r, g, b = 0, 0, 0

        if tags.get('is_live'):
          r = int(r/2)
          b = int(b/2)

        if tags.get('is_live') == False:
          g = int(g/2)
          b = int(b/2)

        png.putpixel((col, row), (int(r), int(g), int(b)))

    return png

  # Create a csv of the individual leaf disk data
  def disk_data_csv(self):
    # Create a header row with numbers for each column
    num_columns = max((len(row) for row in self.rows), default=0)
    headers = [''] + [str(i) for i in range(1, num_columns + 1)] + ['Average']
    lines = [','.join(headers)]

    for i, row in enumerate(self.rows):
      values  = [b.color_deviation for b in row]
      avg_val = average(values)
      line    = [str(i)] + [f"{v:.3f}" for v in values] + [f"{avg_val:.3f}"]
      lines.append(','.join(line))

    return '\n'.join(lines)

  # Load the pixels from the image
  def load_image(self, file_path):
    # Load image
    self.rgb_image = io.imread(file_path)

    # Convert RGB to Lab
    self.lab_image = color.rgb2lab(self.rgb_image)

    # Initialize pixel tags array
    height = len(self.rgb_image)
    width = len(self.rgb_image[0])
    self.pixel_tags = [[{} for row in range(width)] for col in range(height)]

  # Mark blob borders on the image
  def label_blob_borders(self):
    for blob in self.leaf_disk_blobs:
      for col in range(blob.left, blob.right + 1):
        self.pixel_tags[blob.top][col]['is_leaf_disk_box']    = True
        self.pixel_tags[blob.bottom][col]['is_leaf_disk_box'] = True

      for row in range(blob.top, blob.bottom + 1):
        self.pixel_tags[row][blob.left]['is_leaf_disk_box']  = True
        self.pixel_tags[row][blob.right]['is_leaf_disk_box'] = True

  # Add corner markers to each blob to indicate which row it got grouped into
  def label_row_groups(self):
    for blob in self.leaf_disk_blobs:
      self.label_row_marker_blocks(blob, blob.row_group + 1)

  # Draw the corner blocks for a single blob, binary based on if block is or isn't present
  def label_row_marker_blocks(self, blob, number):
    block_size = round((blob.bottom - blob.top) / 10)

    # Top left (1s)
    if number % 2 == 1:
      self.label_row_marker_pixels(blob.top, blob.left, block_size)
    # Top right (2s)
    if (number // 2) % 2 == 1:
      self.label_row_marker_pixels(blob.top, blob.right - block_size, block_size)
    # Bottom left (4s)
    if (number // 4) % 2 == 1:
      self.label_row_marker_pixels(blob.bottom - block_size, blob.left, block_size)
    # Bottom right (8s)
    if (number // 8) % 2 == 1:
      self.label_row_marker_pixels(blob.bottom - block_size, blob.right - block_size, block_size)

  # Set row marker pixels starting at the given coordinates
  def label_row_marker_pixels(self, start_row, start_col, size):
    for row in range(start_row, start_row + size + 1):
      for col in range(start_col, start_col + size + 1):
        if 0 <= row < len(self.rgb_image) and 0 <= col < len(self.rgb_image[0]):
          self.pixel_tags[row][col]['is_row_marker'] = True

  def set_avg_radius(self):
    self.avg_radius = average([b.radius for b in self.leaf_disk_blobs])


# ============================================== #
# Main
# ============================================== #

def load_file(file_path):
  base_file_name = os.path.basename(file_path)
  file_name_no_ext = os.path.splitext(base_file_name)[0]

  if not os.path.exists(file_path):
    print(f"File not found: {file_path}", file=sys.stderr)
    continue

  print(f"Processing {base_file_name}...")

  # Process and score the image
  image = LeafDiskImage(file_path)
  image.process_image()

  return image

def main():
  output_dir = 'output'

  if len(sys.argv) < 2:
    print("Usage: python calcs.py image1.png [image2.png ...]")
    sys.exit(1)

  processed_images = []

  # Calculate first image avgs
  image = load_file(sys.argv[1])
  image.set_reference_colors()
  ref_colors = image.reference_colors
  image.set_color_deviations(ref_colors)

  for file_path in sys.argv[2:]:
    image = load_file(file_path)
    image.set_color_deviations(ref_colors)
    processed_images.append(image)

    # Write the scores csv
    scores_csv_path = f"{output_dir}/{file_name_no_ext}_scores.csv"
    write_file(scores_csv_path, image.disk_data_csv())
    print(f"  Saved scores csv: {scores_csv_path}")

    # Highlighted image
    highlighted_path = os.path.join(output_dir, f"{file_name_no_ext}_highlighted.png")
    image.get_highlighted_image().save(highlighted_path)
    print(f"  Saved highlighted image: {highlighted_path}")

if __name__ == '__main__':
  main()
