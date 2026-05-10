#!/usr/bin/env python3
# Usage: python calcs.py image1.png [image2.png ...]

import sys
import os
import math
import numpy as np
from PIL import Image

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

# Add the pixel to the list of blobs
# optionally provide a function to determine if it is a match
def add_pixel_to_blobs(row, col, pixel, blobs, is_match=None):
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

  matching_blob.add_pixel(row, col, pixel)

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

# Convert sRGB value to linear RGB
def srgb_to_linear(value):
  value /= 255

  if value <= 0.04045:
    return value / 12.92
  else:
    return ((value + 0.055) / 1.055) ** 2.4

# Convert sRGB pixel to linear RGB
def srgb_pixel_to_linear(pixel):
  return [srgb_to_linear(val) for val in pixel]

# Convert linear RGB value to sRGB
def linear_to_srgb(value):
  if value <= 0.0031308:
    srgb = value * 12.92
  else:
    srgb = (1.055 * (value ** (1/2.4)) - 0.055)

  return srgb * 255

# Convert sRGB pixel to linear RGB
def linear_pixel_to_srgb(pixel):
  return [linear_to_srgb(val) for val in pixel]

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
    self.coordinates = []
    self.avg_r = 0
    self.avg_g = 0
    self.avg_b = 0

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

  # Returns true if the coordinates are contained by or adjacent to the blob
  def touches(self, row, col):
    return (self.top - 1) <= row <= (self.bottom + 1) and (self.left - 1) <= col <= (self.right + 1)

  # Adjust the boundaries if necessary and add the coordinates to the array
  def add_pixel(self, row, col, pixel):
    if self.top > row: self.top = row
    if self.bottom < row: self.bottom = row
    if self.left > col: self.left = col
    if self.right < col: self.right = col

    # Update avg colors
    self.avg_r = self.add_value_to_avg(self.avg_r, pixel['r'])
    self.avg_g = self.add_value_to_avg(self.avg_g, pixel['g'])
    self.avg_b = self.add_value_to_avg(self.avg_b, pixel['b'])

    self.coordinates.append({'row': row, 'col': col})

  # Merge the blob into this one
  def merge(self, blob):
    self.top    = min(self.top,    blob.top)
    self.bottom = max(self.bottom, blob.bottom)
    self.left   = min(self.left,   blob.left)
    self.right  = max(self.right,  blob.right)

    # Update avg colors
    self.avg_r = self.merge_avgs(self.avg_r, len(self.coordinates), blob.avg_r, len(blob.coordinates))
    self.avg_g = self.merge_avgs(self.avg_g, len(self.coordinates), blob.avg_g, len(blob.coordinates))
    self.avg_b = self.merge_avgs(self.avg_b, len(self.coordinates), blob.avg_b, len(blob.coordinates))

    self.coordinates.extend(blob.coordinates)

  # Add one new value to the existing average
  def add_value_to_avg(self, avg, new_val):
    return (avg * len(self.coordinates) + new_val) / (len(self.coordinates) + 1)

  # Combine averages of two blobs
  def merge_avgs(self, avg_1, len_1, avg_2, len_2):
    return ((avg_1 * len_1) + (avg_2 * len_2)) / (len_1 + len_2)

  # Returns true if the blob's height and width are roughly equal,
  # it has roughly the number of dark pixels expected if it were circular,
  # and the radius is greater than 62 (the image shouldn't be less than 200 dpi, leaf disk radius is 5/16")
  def is_leaf_disk(self):
    is_square           = is_within_tolerance(self.height, self.width, 0.1)
    expected_pixels     = math.pi * self.radius**2
    is_correct_pixel_count = is_within_tolerance(expected_pixels, len(self.coordinates), 0.1)
    is_large_enough     = self.radius > 62

    return is_square and is_correct_pixel_count and is_large_enough

  # Returns true if the blob has an aspect ratio of 2.25 x 3.25
  # and the height and width are greater than 400 (the image shouldn't be less than 200 dpi, minimum card dimension is 2.25)
  def is_calibration_card(self):
    aspect_ratio     = self.height / max(self.width, 1)
    is_correct_ratio = is_within_tolerance(aspect_ratio, 2.25 / 3.25, 0.2) or is_within_tolerance(aspect_ratio, 3.25 / 2.25, 0.2)
    is_large_enough  = self.height > 400 and self.width > 400

    return is_correct_ratio and is_large_enough

  # Returns true if the blob is square,
  # it has roughly the number of pixels expected if it were square,
  # and the height and width are greater than 65 (the image shouldn't be less than 200 dpi, squares are about 0.325")
  def is_color_square(self):
    is_square           = is_within_tolerance(self.height, self.width, 0.1)
    expected_pixels     = self.height * self.width
    is_correct_pixel_count = is_within_tolerance(expected_pixels, len(self.coordinates), 0.1)
    is_large_enough     = self.height > 65 and self.width > 65

    return is_square and is_correct_pixel_count and is_large_enough

  def boundaries(self):
    return {
      'top': self.top,
      'bottom': self.bottom,
      'left': self.left,
      'right': self.right
    }

  def averages(self):
    return {
      'red': self.avg_r,
      'green': self.avg_g,
      'blue': self.avg_b
    }

  def to_dict(self):
    return {
      'top': self.top,
      'bottom': self.bottom,
      'left': self.left,
      'right': self.right,
      'red': self.avg_r,
      'green': self.avg_g,
      'blue': self.avg_b
    }


# ============================================== #
# ColorCalibrationCard class
# Info about process: https://www.imatest.com/docs/colormatrix/
# ============================================== #

class ColorCalibrationCard():
  # Reference values for the Calibrite ColorChecker Classic Mini
  REFERENCE_RGB = [
    [
      {'r': 115, 'g': 82, 'b': 68},
      {'r': 194, 'g': 150, 'b': 130},
      {'r': 98, 'g': 122, 'b': 157},
      {'r': 87, 'g': 108, 'b': 67},
      {'r': 133, 'g': 128, 'b': 177},
      {'r': 103, 'g': 189, 'b': 170}
    ],
    [
      {'r': 214, 'g': 126, 'b': 44},
      {'r': 80, 'g': 91, 'b': 166},
      {'r': 193, 'g': 90, 'b': 99},
      {'r': 94, 'g': 60, 'b': 108},
      {'r': 157, 'g': 188, 'b': 64},
      {'r': 224, 'g': 163, 'b': 46}
    ],
    [
      {'r': 56, 'g': 61, 'b': 150},
      {'r': 70, 'g': 148, 'b': 73},
      {'r': 175, 'g': 54, 'b': 60},
      {'r': 231, 'g': 199, 'b': 31},
      {'r': 187, 'g': 86, 'b': 149},
      {'r': 8, 'g': 133, 'b': 161}
    ],
    [
      {'r': 243, 'g': 243, 'b': 243},
      {'r': 200, 'g': 200, 'b': 200},
      {'r': 160, 'g': 160, 'b': 160},
      {'r': 122, 'g': 122, 'b': 122},
      {'r': 85, 'g': 85, 'b': 85},
      {'r': 52, 'g': 52, 'b': 52}
    ]
  ]

  def __init__(self, blob):
    self.top    = blob.top
    self.bottom = blob.bottom
    self.left   = blob.left
    self.right  = blob.right
    self.color_squares = []
    self.rows          = []
    self.correction_matrix = []

  def find_color_card_values(self, pixels):
    # Group pixels into blobs based on similar color
    for row in range(self.top, self.bottom + 1):
      # Discard any that aren't wide enough for efficiency
      self.color_squares = [c for c in self.color_squares if c.width > 65]

      for col in range(self.left, self.right + 1):
        pixel = pixels[row][col]

        add_pixel_to_blobs(row, col, pixel, self.color_squares, lambda b: self.pixel_matches_blob_color(pixel, b))

    # Filter down blobs to just the color squares
    self.color_squares = [c for c in self.color_squares if c.is_color_square()]

    # Group into rows
    self.rows = group_blobs_into_rows(self.color_squares)

    # Orient the color squares to match the reference
    self.orient_rows_to_reference()

  # Calculate the 3x3 matrix to correct the RGB values in the original image
  def calculate_correction_matrix(self):
    # Convert image and reference values to linear RGB
    observed_colors = pixels_to_rgb_array(self.get_avg_color_square_pixels())
    reference_colors = pixels_to_rgb_array(self.REFERENCE_RGB)
    linear_observed_colors = [srgb_pixel_to_linear(c) for c in observed_colors]
    linear_reference_colors = [srgb_pixel_to_linear(c) for c in reference_colors]

    # Calculate 3x3 conversion matrix
    self.correction_matrix, _, _, _ = np.linalg.lstsq(linear_observed_colors, linear_reference_colors, rcond=None)

  # The value is close if it is +/- 5 of the average
  def pixel_value_is_close(self, pixel_val, avg_val):
    return avg_val - 5 <= pixel_val <= avg_val + 5

  # The pixel matches if all RGB values are close
  def pixel_matches_blob_color(self, pixel, blob):
    return (self.pixel_value_is_close(pixel['r'], blob.avg_r) and
            self.pixel_value_is_close(pixel['g'], blob.avg_g) and
            self.pixel_value_is_close(pixel['b'], blob.avg_b))

  # Orient the extracted rows to best align with the reference color array
  def orient_rows_to_reference(self):
    # If the number of rows is not aligned, rotate 90 degrees
    if len(self.rows) != len(self.REFERENCE_RGB):
      self.rotate_color_squares_90()

    # Calculate differences
    error_1 = self.calculate_color_error()
    self.rotate_color_squares_180()
    error_2 = self.calculate_color_error()

    # If the first error was less, set it back to that orientation
    if error_1 < error_2:
      self.rotate_color_squares_180()

  # Rotate the color_squares array 90 degrees counter clockwise
  def rotate_color_squares_90(self):
    num_rows = len(self.rows)
    num_cols = len(self.rows[0])

    # i = 0 to num_rows - 1
    # j = num_cols - 1 to 0
    self.rows = [[self.rows[i][j] for i in range(num_rows)] for j in range(num_cols - 1, -1, -1)]

  # Rotate the color_squares array 180 degrees
  def rotate_color_squares_180(self):
    self.rotate_color_squares_90()
    self.rotate_color_squares_90()

  # Calculate the difference between the color squares and the reference array
  def calculate_color_error(self):
    before_error = 0

    for i, row in enumerate(self.rows):
      for j, square in enumerate(row):
        before_error += value_error(square.avg_r, self.REFERENCE_RGB[i][j]['r'])
        before_error += value_error(square.avg_g, self.REFERENCE_RGB[i][j]['g'])
        before_error += value_error(square.avg_b, self.REFERENCE_RGB[i][j]['b'])

    print(f"before_error: {before_error}")

    if len(self.correction_matrix) == 3:
      corrected_squares = self.correct_pixels(self.get_avg_color_square_pixels())
      after_error = 0

      for i, row in enumerate(corrected_squares):
        for j, square in enumerate(row):
          after_error += value_error(square['r'], self.REFERENCE_RGB[i][j]['r'])
          after_error += value_error(square['g'], self.REFERENCE_RGB[i][j]['g'])
          after_error += value_error(square['b'], self.REFERENCE_RGB[i][j]['b'])

      print(f"after_error: {after_error}")


    return before_error

  # Convert the average RGB values for the color squares into a pixel array
  def get_avg_color_square_pixels(self):
    result = []

    for row in self.rows:
      result.append([{'r': square.avg_r, 'g': square.avg_g, 'b': square.avg_b} for square in row])

    return result

  # Color correct the pixels using the correction_matrix
  def correct_pixels(self, pixels):
    # Transform to a matrix of RGB values and linearize
    rgb_array = pixels_to_rgb_array(pixels)
    linear_rgb_array = [srgb_pixel_to_linear(rgb) for rgb in rgb_array]

    # Multiply by correction_matrix
    corrected_rgb_array = linear_rgb_array @ self.correction_matrix

    # Convert to srgb
    rgb_array = [linear_pixel_to_srgb(rgb) for rgb in corrected_rgb_array]

    # Convert to 2D array
    return rgb_array_to_pixels(rgb_array, len(pixels), len(pixels[0]))


# ============================================== #
# LeafDisk class
# A PixelBlob that is a leaf disk
# ============================================== #

class LeafDisk(PixelBlob):
  def __init__(self, blob, pixels):
    self.top    = blob.top
    self.bottom = blob.bottom
    self.left   = blob.left
    self.right  = blob.right
    self.coordinates          = blob.coordinates
    self.necrotic_coordinates = [c for c in blob.coordinates if pixels[c['row']][c['col']]['is_necrotic']]
    self.live_coordinates     = [c for c in blob.coordinates if pixels[c['row']][c['col']]['is_dark']]
    self.row_group = None
    self.avg_necrotic_value_sum = None

  @property
  def radius(self):
    return (self.height + self.width) / 4


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

        add_pixel_to_blobs(row, col, pixel, self.dark_blobs)

    # Find the color calibration card
    color_card = [b for b in self.dark_blobs if b.is_calibration_card()][0]
    color_card = ColorCalibrationCard(color_card)
    color_card.find_color_card_values(self.pixels)
    color_card.calculate_correction_matrix()

    self.pixels = color_card.correct_pixels(self.pixels)

    color_card.calculate_color_error()

    return









    # Set the leaf disk blobs and group them into rows
    self.leaf_disk_blobs = [b for b in self.dark_blobs if b.is_leaf_disk()]
    self.label_blob_borders()
    self.set_leaf_disk_rows()
    self.set_avg_radius()

    # Calculate the scores
    for blob in self.leaf_disk_blobs:
      self.calculate_disk_score(blob)

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
  def load_pixels(self, file_path):
    img = Image.open(file_path)
    width, height = img.size
    pixels = [[{'r': 0, 'g': 0, 'b': 0} for _ in range(width)] for _ in range(height)]

    for row in range(height):
      for col in range(width):
        pixel = img.getpixel((col, row))
        r = pixel[0]
        g = pixel[1]
        b = pixel[2]

        pixels[row][col] = {'r': r, 'g': g, 'b': b}
    return pixels

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

  # Calculate the score for each leaf disk (for the single solution test)
  def calculate_disk_score(self, blob):
    rad = round(blob.radius * 1.1)
    center = blob.center_coordinates
    center_row = center['center_row']
    center_col = center['center_col']

    pixel_counts        = [0] * rad
    rg_diff_sums        = [None] * rad
    necrotic_value_sums = [0] * rad

    # Sum up the red green differences for each pixel in the leaf disk
    for coord in blob.coordinates:
      row, col = coord['row'], coord['col']
      d = round(point_distance(row, col, center_row, center_col))

      # Skip pixels outside the radius
      if not (0 <= d < rad):
        continue

      if rg_diff_sums[d] is None:
        rg_diff_sums[d] = 0

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

    avgs = [v - min_avg if v is not None else None for v in avgs]

    blob.avg_necrotic_value_sum = sum_real(avgs[necrotic_extent:])


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

    image.get_highlighted_image().save('output/highlighted.png')
    return



    base = os.path.splitext(os.path.basename(file_path))[0]
    dir_name = 'output'

    # Highlighted image
    highlighted_path = os.path.join(dir_name, f"{base}_highlighted.png")
    image.get_highlighted_image().save(highlighted_path)
    print(f"  Saved highlighted image: {highlighted_path}")

    # Disk data CSV
    disk_csv_path = os.path.join(dir_name, f"{base}_avgNecroticValueSums.csv")
    with open(disk_csv_path, 'w') as f:
      f.write('\n'.join(image.disk_data_csv()))
    print(f"  Saved disk data CSV:      {disk_csv_path}")

    print(f"  Average radius: {image.avg_radius:.2f} px")
    print(f"  Rows: {[len(row) for row in image.rows]}")

if __name__ == '__main__':
  main()
