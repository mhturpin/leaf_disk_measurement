#!/usr/bin/env python3
# Usage: python calcs.py image1.png [image2.png ...]

import sys
import os
import math
from PIL import Image

# ============================================== #
# Utility functions (top-level, available everywhere)
# ============================================== #

# Calls the function with each row and col for the given ranges
# Indices are inclusive
def for_each_ij(start_i, end_i, start_j, end_j, block):
  for i in range(start_i, end_i + 1):
    for j in range(start_j, end_j + 1):
      block(i, j)

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

# Average an array of numbers
def average(arr):
  real = [v for v in arr if is_real_number(v)]

  return 0 if not real else sum(real) / len(real)

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
    self.coordinates          = []
    self.necrotic_coordinates = []
    self.live_coordinates     = []
    self.row_group = None
    self.avg_necrotic_value_sum = None

  # Returns true if the coordinates are contained by or adjacent to the blob
  def touches(self, row, col):
    return (self.top - 1) <= row <= (self.bottom + 1) and (self.left - 1) <= col <= (self.right + 1)

  # Adjust the boundaries if necessary and add the coordinates to the array
  def add_pixel(self, row, col, is_necrotic):
    if self.top > row: self.top = row
    if self.bottom < row: self.bottom = row
    if self.left > col: self.left = col
    if self.right < col: self.right = col

    self.coordinates.append({'row': row, 'col': col})

    if is_necrotic:
      self.necrotic_coordinates.append({'row': row, 'col': col})
    else:
      self.live_coordinates.append({'row': row, 'col': col})

  # Merge the blob into this one
  def merge(self, blob):
    self.top    = min(self.top,    blob.top)
    self.bottom = max(self.bottom, blob.bottom)
    self.left   = min(self.left,   blob.left)
    self.right  = max(self.right,  blob.right)

    self.coordinates.extend(blob.coordinates)
    self.necrotic_coordinates.extend(blob.necrotic_coordinates)
    self.live_coordinates.extend(blob.live_coordinates)

  @property
  def height(self):
    return self.bottom - self.top

  @property
  def width(self):
    return self.right - self.left

  @property
  def radius(self):
    return (self.height + self.width) / 4

  def center_coordinates(self):
    return {
      'center_row': (self.bottom + self.top) / 2,
      'center_col': (self.right + self.left) / 2
    }

  # Returns true if the blob's height and width are roughly equal,
  # if it has roughly the number of dark pixels expected if it were circular,
  # and if the radius is greater than 62 (the image shouldn't be less than 200 dpi, 200*5/16 = leaf disk radius)
  def is_leaf_disk(self):
    is_square           = is_within_tolerance(self.height, self.width, 0.1)
    expected_pixels     = math.pi * self.radius**2
    correct_pixel_count = is_within_tolerance(expected_pixels, len(self.coordinates), 0.1)

    return is_square and correct_pixel_count and self.radius > 62


# ============================================== #
# LeafDiskImage class
# Handles the entire image
# Finds leaf disks
# Does calculations
# ============================================== #

class LeafDiskImage:
  def __init__(self, file_path):
    self.file_path       = file_path
    self.dark_blobs      = []
    self.leaf_disk_blobs = []
    self.rows            = []
    self.pair_scores_csv = None
    self.pixels          = None

  # Do all the image processing from loading the file to determining necrotic areas
  def process_image(self):
    self.pixels = self.load_pixels(self.file_path)
    height = len(self.pixels)
    width  = len(self.pixels[0])

    # Find dark blobs
    for row in range(height):
      for col in range(width):
        pixel = self.pixels[row][col]

        # If pixel is too light, skip
        if pixel['r'] + pixel['g'] + pixel['b'] >= 500:
          continue

        pixel['is_dark']     = True
        pixel['is_necrotic'] = pixel['r'] > pixel['g']

        # Find blobs that touch the pixel
        indices = self.find_touching_blob_indices(row, col)

        if len(indices) == 0:
          # If there are no matches, create a new blob
          blob = PixelBlob()
          self.dark_blobs.append(blob)
          matching_blob = blob
        elif len(indices) == 1:
          # If there is only one match use that
          matching_blob = self.dark_blobs[indices[0]]
        elif len(indices) == 2:
          # If there are two matches, merge them
          matching_blob = self.dark_blobs[indices[0]]
          matching_blob.merge(self.dark_blobs[indices[1]])
          self.dark_blobs.pop(indices[1])
        else:
          raise ValueError(f"A pixel matched {len(indices)} blobs")

        matching_blob.add_pixel(row, col, pixel['is_necrotic'])

    # Set the leaf disk blobs and group them into rows
    self.leaf_disk_blobs = [b for b in self.dark_blobs if b.is_leaf_disk()]
    self.label_blob_borders()
    self.set_leaf_disk_rows()
    self.set_avg_radius()

    # Calculate the scores
    for blob in self.leaf_disk_blobs:
      self.calculate_disk_score(blob)

    self.slope_score_linear_regression = self.calculate_slope_score()
    self.calculate_pair_slope_scores()

  # Create a visualization
  def get_highlighted_image(self):
    height = len(self.pixels)
    width  = len(self.pixels[0])
    png    = Image.new('RGB', (width, height))

    for row in range(height):
      for col in range(width):
        pixel = self.pixels[row][col]
        r, g, b = pixel['r'], pixel['g'], pixel['b']

        # Mark dark pixels green
        if pixel.get('is_dark'):
          v = max(0, min(255, ((r - g + 50) * 255 / 100)))
          r, g, b = v, v, v

        # Mark leaf disk boxes and row markers black
        if pixel.get('is_leaf_disk_box') or pixel.get('is_row_marker'):
          r, g, b = 0, 0, 0

        # Mark best fit circle white
        if pixel.get('is_best_fit_circle'):
          r, g, b = 255, 255, 255

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

  def pair_scores_csv(self):
    return self._pair_scores_csv

  def _pair_scores_csv(self):
    return self.pair_scores_csv

  # Private methods
  def load_pixels(self, file_path):
    img = Image.open(file_path)
    width, height = img.size
    pixels = [[{'r': 0, 'g': 0, 'b': 0} for _ in range(width)] for _ in range(height)]

    for row in range(height):
      for col in range(width):
        r, g, b = img.getpixel((col, row))
        pixels[row][col] = {'r': r, 'g': g, 'b': b}
    return pixels

  # Return an array of indices of all blobs that touch the given pixel
  def find_touching_blob_indices(self, row, col):
    indices = []

    for i, blob in enumerate(self.dark_blobs):
      if blob.touches(row, col):
        indices.append(i)

    return indices

  # Mark blob borders on the image
  def label_blob_borders(self):
    for blob in self.leaf_disk_blobs:
      for col in range(blob.left, blob.right + 1):
        self.pixels[blob.top][col]['is_leaf_disk_box']    = True
        self.pixels[blob.bottom][col]['is_leaf_disk_box'] = True

      for row in range(blob.top, blob.bottom + 1):
        self.pixels[row][blob.left]['is_leaf_disk_box']  = True
        self.pixels[row][blob.right]['is_leaf_disk_box'] = True

  # Group the leaf disks into sorted rows
  def set_leaf_disk_rows(self):
    self.rows = []

    for blob in self.leaf_disk_blobs:
      assigned = False

      # Try to find a row that it matches
      for i, row in enumerate(self.rows):
        mid = blob.center_coordinates()['center_row']

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

  # Calculate the score for each leaf disk (for the single solution test)
  def calculate_disk_score(self, blob):
    rad = round(blob.radius * 1.1)
    center = blob.center_coordinates()
    center_row = center['center_row']
    center_col = center['center_col']

    pixel_counts        = [0] * rad
    rg_diff_sums        = [0] * rad
    necrotic_value_sums = [0] * rad

    # Sum up the red green differences for each pixel in the leaf disk
    for coord in blob.coordinates:
      row, col = coord['row'], coord['col']
      d = round(point_distance(row, col, center_row, center_col))

      # Skip pixels outside the radius
      if not (0 <= d < rad):
        continue

      r = self.pixels[row][col]['r']
      g = self.pixels[row][col]['g']
      pixel_counts[d]        += 1
      rg_diff_sums[d]        += r - g
      necrotic_value_sums[d] += r - g

    real_sums = [s for s in rg_diff_sums if is_real_number(s)]

    if not real_sums:
      blob.avg_necrotic_value_sum = 0
      return

    # The minimum sum is the extent of necrotic damage
    # Because green > red in live tissue and the center has fewer pixels, the sum increases towards the center
    # This wouldn't work if the live tissue is heavily pigmented and has red > green
    min_sum = min(real_sums)
    necrotic_extent = rg_diff_sums.index(min_sum)

    # Calculate the averages
    avgs = []
    for i, s in enumerate(necrotic_value_sums):
      if s is not None and pixel_counts[i] is not None and pixel_counts[i] > 0:
        avgs.append(s / pixel_counts[i])
      else:
        avgs.append(None)

    min_avg = avgs[necrotic_extent]

    print(min_avg)
    avgs = [v - min_avg if v is not None else None for v in avgs]

    blob.avg_necrotic_value_sum = sum_real(avgs[necrotic_extent:])

  def calculate_slope_score(self):
    if len(self.rows) != 4:
      print(f"  Note: {len(self.rows)} rows found (expected 4), skipping slope score.")
      return None

    log_concentrations = [math.log10(8), math.log10(12), math.log10(14), math.log10(16)]
    data = [{'x': log_concentrations[i], 'y': average([b.avg_necrotic_value_sum for b in row])} for i, row in enumerate(self.rows)]

    return linear_regression(data)

  def calculate_pair_slope_scores(self):
    if len(self.rows) % 2 != 0:
      print(f"  Note: {len(self.rows)} rows found (odd number), skipping pair slope scores.")
      return

    log_concentrations = [math.log10(8), math.log10(16)]
    lines = [',Leaf 1,Leaf 2,Leaf 3,Average']

    for i in range(0, len(self.rows), 2):
      sums1 = [b.avg_necrotic_value_sum for b in self.rows[i]]
      sums2 = [b.avg_necrotic_value_sum for b in self.rows[i+1]]

      pair_scores = []
      for j, rate in enumerate(sums1):
        reg = linear_regression([
          {'x': log_concentrations[0], 'y': rate},
          {'x': log_concentrations[1], 'y': sums2[j]}
        ])
        pair_scores.append(reg['slope'])

      pair_scores.append(average(pair_scores))
      row_line = [f"Tree {i // 2}"] + [f"{s:.3f}" for s in pair_scores]
      lines.append(','.join(row_line))

    self.pair_scores_csv = lines


# ============================================== #
# Main
# ============================================== #

def main():
  if len(sys.argv) < 2:
    print("Usage: python calcs.py image1.png [image2.png ...]")
    sys.exit(1)

  slope_score_rows = ['File Name,Slope Score,R Squared']

  for file_path in sys.argv[1:]:
    if not os.path.exists(file_path):
      print(f"File not found: {file_path}", file=sys.stderr)
      continue

    print(f"Processing {file_path}...")

    image = LeafDiskImage(file_path)
    image.process_image()

    base = os.path.splitext(os.path.basename(file_path))[0]
    dir_name = os.path.dirname(file_path) or '.'

    # Highlighted image
    highlighted_path = os.path.join(dir_name, f"{base}_highlighted.png")
    image.get_highlighted_image().save(highlighted_path)
    print(f"  Saved highlighted image: {highlighted_path}")

    # Disk data CSV
    disk_csv_path = os.path.join(dir_name, f"{base}_avgNecroticValueSums.csv")
    with open(disk_csv_path, 'w') as f:
      f.write('\n'.join(image.disk_data_csv()))
    print(f"  Saved disk data CSV:      {disk_csv_path}")

    # Pair scores CSV
    if image.pair_scores_csv:
      pair_csv_path = os.path.join(dir_name, f"{base}_pairScores.csv")
      with open(pair_csv_path, 'w') as f:
        f.write('\n'.join(image.pair_scores_csv))
      print(f"  Saved pair scores CSV:    {pair_csv_path}")

    # Slope score
    reg = image.slope_score_linear_regression
    if reg:
      print(f"  Slope:        {reg['slope']:.2f}")
      print(f"  Y-Intercept: {reg['y_intercept']:.2f}")
      print(f"  R²:           {reg['r_squared']:.2f}")
      slope_score_rows.append(f"{os.path.basename(file_path)},{reg['slope']:.2f},{reg['r_squared']:.2f}")

    print(f"  Average radius: {image.avg_radius:.2f} px")
    print(f"  Rows: {[len(row) for row in image.rows]}")

  # Combined slope scores CSV (always written, even if empty)
  slope_csv_path = os.path.join(os.getcwd(), 'slopeScores.csv')
  with open(slope_csv_path, 'w') as f:
    f.write('\n'.join(slope_score_rows))
  print(f"\nSaved combined slope scores: {slope_csv_path}")

if __name__ == '__main__':
  main()
