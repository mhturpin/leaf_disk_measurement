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
    self.pixel_scores = []

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
      'rgb': {'r': rgb[0], 'g': rgb[1], 'b': rgb[2]},
      'lab': {'l': lab[0], 'a': lab[1], 'b': lab[2]}
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

  # Set the live averages for all the candidate injury scores
  def set_live_avgs(self):
    c_row = self.center_coordinates['center_row']
    c_col = self.center_coordinates['center_col']
    count = 0
    rgb_r_total = 0
    rgb_g_total = 0
    rgb_b_total = 0
    lab_l_total = 0
    lab_a_total = 0
    lab_b_total = 0

    for data in self.pixel_data:
      row = data['row']
      col = data['col']

      # If the pixel is inside the known live area, add it to the totals
      # Adjust depending on the extent of necrosis
      if point_distance(row, col, c_row, c_col) < self.radius/2:
        count += 1
        rgb_r_total += data['rgb']['r']
        rgb_g_total += data['rgb']['g']
        rgb_b_total += data['rgb']['b']
        lab_l_total += data['lab']['l']
        lab_a_total += data['lab']['a']
        lab_b_total += data['lab']['b']

    self.live_avgs = {
      'rgb': {
        'r': rgb_r_total/count,
        'g': rgb_g_total/count,
        'b': rgb_b_total/count,
        'r_minus_g': (rgb_r_total + rgb_g_total)/count,
        'r_minus_g_normalized': (rgb_r_total + rgb_g_total)/(rgb_r_total + rgb_g_total + rgb_b_total),
        'r_div_g': rgb_r_total/rgb_g_total,
        'r_minus_avg_g_b': (rgb_r_total - (rgb_g_total + rgb_b_total)/2)/count
      },
      'lab': {
        'l': lab_l_total/count,
        'a': lab_a_total/count,
        'b': lab_b_total/count,
        'a_plus_b': (lab_a_total + lab_b_total)/count
      }
    }

  # Set raw candidate values for all pixels in the blob
  def set_all_raw_injury_values(self):
    for data in self.pixel_data:
      self.set_raw_injury_values(data)

  # Set the raw candidate values for the given pixel
  def set_raw_injury_values(self, data):
    r = data['rgb']['r']
    g = data['rgb']['g']
    b = data['rgb']['b']

    data['raw'] = {
      'rgb': {
        'r_minus_g': r - g,
        'r_minus_g_normalized': (r - g)/max(r + g + b, 1),
        'r_div_g': r/max(g, 1),
        'r_minus_avg_g_b': r - ((g + b)/2)
      },
      'lab': {
        'a_plus_b': data['lab']['a'] + data['lab']['b']
      }
    }

  # Set scores for all pixels in the blob
  def set_all_pixel_scores(self):
    for data in self.pixel_data:
      self.set_all_pixel_scores(values)

  # Set scores for the given pixel
  def set_all_pixel_scores(self, data):
    rgb_r_diff = data['rgb']['r'] - self.live_avgs['rgb']['r']
    rgb_g_diff = data['rgb']['g'] - self.live_avgs['rgb']['g']
    rgb_b_diff = data['rgb']['b'] - self.live_avgs['rgb']['b']
    lab_l_diff = data['lab']['l'] - self.live_avgs['lab']['l']
    lab_a_diff = data['lab']['a'] - self.live_avgs['lab']['a']
    lab_b_diff = data['lab']['b'] - self.live_avgs['lab']['b']

    data['scores'] = {
      'rgb': {
        'r': rgb_r_diff,
        'g': rgb_g_diff,
        'b': rgb_b_diff,
        'r_minus_g': data['raw']['rgb']['r_minus_g'] - data['r_minus_g'],
        'r_minus_g_normalized': data['raw']['rgb']['r_minus_g_normalized'] - data['r_minus_g_normalized'],
        'r_div_g': data['raw']['rgb']['r_div_g'] - data['r_div_g'],
        'r_minus_avg_g_b': data['raw']['rgb']['r_minus_avg_g_b'] - data['r_minus_avg_g_b'],
        'delta_e': sqrt(rgb_r_diff**2 + rgb_g_diff**2 + rgb_b_diff**2)
      },
      'lab': {
        'l': lab_l_diff,
        'a': lab_a_diff,
        'b': lab_b_diff,
        'a_plus_b': data['raw']['lab']['a_plus_b'] - self.live_avgs['lab']['a_plus_b'],
        'delta_e': sqrt(lab_l_diff**2 + lab_a_diff**2 + lab_b_diff**2)
      }
    }








  def boundaries(self):
    return {
      'top': self.top,
      'bottom': self.bottom,
      'left': self.left,
      'right': self.right
    }

  def to_dict(self):
    return {
      'top': self.top,
      'bottom': self.bottom,
      'left': self.left,
      'right': self.right
    }


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
    self.dark_blobs      = []
    self.leaf_disk_blobs = []
    self.rows            = []

  # Do all the image processing from loading the file to determining necrotic areas
  def process_image(self):
    # Load image (both RGB and Lab versions)
    self.load_image(self.file_path)

    # Find dark blobs
    for row, rgb_row in enumerate(self.rgb_image):
      for col, rgb in enumerate(rgb_row):
        # If pixel is dark, add it to blobs
        if rgb[0] + rgb[1] + rgb[2] <= 500:
          add_pixel_to_blobs(row, col, rgb, self.lab_image[row][col], self.dark_blobs)

    # Set the leaf disk blobs and group them into rows
    self.leaf_disk_blobs = [b for b in self.dark_blobs if b.is_leaf_disk()]


    # Set the candidate pixel values
    for blob in self.leaf_disk_blobs:
      blob.set_all_raw_injury_values()
      blob.set_live_avgs()
      blob.set_all_pixel_scores()






    # Outline leaf disks for the highlighted image
    self.label_blob_borders()

    # Group the leaf disk blobs into rows
    self.set_leaf_disk_rows()
    self.set_avg_radius()

    # Calculate the scores
    for blob in self.leaf_disk_blobs:
      self.calculate_disk_score(blob)

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

  # Create a visualization
  def get_highlighted_image(self):
    height = len(self.pixels)
    width  = len(self.pixels[0])
    png    = Image.new('RGB', (width, height))

    for row in range(height):
      for col in range(width):
        pixel = self.pixels[row][col]
        r, g, b = pixel['r'], pixel['g'], pixel['b']

        # # Mark dark pixels green
        # if pixel.get('is_dark'):
        #   v = max(0, min(255, ((r - g + 50) * 255 / 100)))
        #   r, g, b = v, v, v

        # # Mark leaf disk boxes and row markers black
        # if pixel.get('is_leaf_disk_box') or pixel.get('is_row_marker'):
        #   r, g, b = 0, 0, 0

        # # Mark best fit circle white
        # if pixel.get('is_best_fit_circle'):
        #   r, g, b = 255, 255, 255

        png.putpixel((col, row), (int(r), int(g), int(b)))
    return png

  # Create a csv of the individual leaf disk data
  def disk_data_csv(self):
    # Create a header row with numbers for each column
    num_columns = max((len(row) for row in self.rows), default=0)
    headers = [''] + [str(i) for i in range(1, num_columns + 1)] + ['Average']
    lines = [','.join(headers)]

    for i, row in enumerate(self.rows):
      values  = [b.avg_necrotic_value_sum for b in row]
      avg_val = average(values)
      line    = [str(i)] + [f"{v:.2f}" for v in values] + [f"{avg_val:.2f}"]
      lines.append(','.join(line))

    return lines

  # Load the pixels from the image
  def load_image(self, file_path):
    # Load image
    self.rgb_image = io.imread(file_path)
    # Convert RGB to Lab
    self.lab_image = color.rgb2lab(self.rgb_image)

  # Mark blob borders on the image
  def label_blob_borders(self):
    for blob in self.leaf_disk_blobs:
      for col in range(blob.left, blob.right + 1):
        self.pixels[blob.top][col]['is_leaf_disk_box']    = True
        self.pixels[blob.bottom][col]['is_leaf_disk_box'] = True

      for row in range(blob.top, blob.bottom + 1):
        self.pixels[row][blob.left]['is_leaf_disk_box']  = True
        self.pixels[row][blob.right]['is_leaf_disk_box'] = True

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
        if 0 <= row < len(self.pixels) and 0 <= col < len(self.pixels[0]):
          self.pixels[row][col]['is_row_marker'] = True

  def set_avg_radius(self):
    self.avg_radius = average([b.radius for b in self.leaf_disk_blobs])


# ============================================== #
# Main
# ============================================== #

def main():
  if len(sys.argv) < 2:
    print("Usage: python calcs.py image1.png [image2.png ...]")
    sys.exit(1)

  for file_path in sys.argv[1:]:
    if not os.path.exists(file_path):
      print(f"File not found: {file_path}", file=sys.stderr)
      continue

    print(f"Processing {file_path}...")

    image = LeafDiskImage(file_path)
    image.process_image()

    base = os.path.splitext(os.path.basename(file_path))[0]
    dir_name = 'output'

    # Highlighted image
    highlighted_path = os.path.join(dir_name, f"{base}_highlighted.png")
    image.get_highlighted_image().save(highlighted_path)
    print(f"  Saved highlighted image: {highlighted_path}")

if __name__ == '__main__':
  main()
