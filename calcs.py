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
    self.aggregates = {}
    self.thresholds = {
      'live': {},
      'necrotic': {}
    }
    self.scores = {
      'rgb': {},
      'lab': {}
    }

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

  # Set the live averages for all the candidate injury scores
  def set_avg_values(self):
    c_row = self.center_coordinates['center_row']
    c_col = self.center_coordinates['center_col']
    live_count = 0
    live_totals = {
      'rgb': { 'r': 0, 'g': 0, 'b': 0 },
      'lab': { 'l': 0, 'a': 0, 'b': 0 }
    }
    necrotic_count = 0
    necrotic_totals = {
      'rgb': { 'r': 0, 'g': 0, 'b': 0 },
      'lab': { 'l': 0, 'a': 0, 'b': 0 }
    }

    for data in self.pixel_data:
      row = data['row']
      col = data['col']

      # If the pixel is inside the known live area, add it to the totals
      # Adjust depending on the extent of necrosis
      if data['rgb']['r'] < data['rgb']['g']: #point_distance(row, col, c_row, c_col) < self.radius/2:
        data['is_live'] = True
        live_count += 1

        for color in ['r', 'g', 'b']:
          live_totals['rgb'][color] += data['rgb'][color]
        for color in ['l', 'a', 'b']:
          live_totals['lab'][color] += data['lab'][color]
      else:
        data['is_live'] = False
        necrotic_count += 1

        for color in ['r', 'g', 'b']:
          necrotic_totals['rgb'][color] += data['rgb'][color]
        for color in ['l', 'a', 'b']:
          necrotic_totals['lab'][color] += data['lab'][color]

    self.aggregates = {
      'live': {
        'average': {
          'rgb': {
            'r': live_totals['rgb']['r']/live_count,
            'g': live_totals['rgb']['g']/live_count,
            'b': live_totals['rgb']['b']/live_count,
            'r_minus_g': (live_totals['rgb']['r'] - live_totals['rgb']['g'])/live_count,
            'r_minus_g_normalized': (live_totals['rgb']['r'] - live_totals['rgb']['g'])/(live_totals['rgb']['r'] + live_totals['rgb']['g'] + live_totals['rgb']['b']),
            'r_div_g': live_totals['rgb']['r']/live_totals['rgb']['g'],
            'r_minus_avg_g_b': (live_totals['rgb']['r'] - (live_totals['rgb']['g'] + live_totals['rgb']['b'])/2)/live_count
          },
          'lab': {
            'l': live_totals['lab']['l']/live_count,
            'a': live_totals['lab']['a']/live_count,
            'b': live_totals['lab']['b']/live_count,
            'a_plus_b': (live_totals['lab']['a'] + live_totals['lab']['b'])/live_count
          }
        }
      },
      'necrotic': {
        'average': {
          'rgb': {
            'r': necrotic_totals['rgb']['r']/necrotic_count,
            'g': necrotic_totals['rgb']['g']/necrotic_count,
            'b': necrotic_totals['rgb']['b']/necrotic_count,
            'r_minus_g': (necrotic_totals['rgb']['r'] - necrotic_totals['rgb']['g'])/necrotic_count,
            'r_minus_g_normalized': (necrotic_totals['rgb']['r'] - necrotic_totals['rgb']['g'])/(necrotic_totals['rgb']['r'] + necrotic_totals['rgb']['g'] + necrotic_totals['rgb']['b']),
            'r_div_g': necrotic_totals['rgb']['r']/necrotic_totals['rgb']['g'],
            'r_minus_avg_g_b': (necrotic_totals['rgb']['r'] - (necrotic_totals['rgb']['g'] + necrotic_totals['rgb']['b'])/2)/necrotic_count
          },
          'lab': {
            'l': necrotic_totals['lab']['l']/necrotic_count,
            'a': necrotic_totals['lab']['a']/necrotic_count,
            'b': necrotic_totals['lab']['b']/necrotic_count,
            'a_plus_b': (necrotic_totals['lab']['a'] + necrotic_totals['lab']['b'])/necrotic_count
          }
        }
      }
    }

  # Set delta e (color difference) live avg
  def set_avg_delta_e(self):
    live_count = 0
    live_rgb_delta_e_total = 0
    live_lab_delta_e_total = 0
    necrotic_count = 0
    necrotic_rgb_delta_e_total = 0
    necrotic_lab_delta_e_total = 0

    for data in self.pixel_data:
      # Set previously in set_avg_values
      if data['is_live']:
        live_count += 1
        live_rgb_delta_e_total += data['raw']['rgb']['delta_e']
        live_lab_delta_e_total += data['raw']['lab']['delta_e']
      else:
        necrotic_count += 1
        necrotic_rgb_delta_e_total += data['raw']['rgb']['delta_e']
        necrotic_lab_delta_e_total += data['raw']['lab']['delta_e']

    self.aggregates['live']['average']['rgb']['delta_e'] = live_rgb_delta_e_total/live_count
    self.aggregates['live']['average']['lab']['delta_e'] = live_lab_delta_e_total/live_count
    self.aggregates['necrotic']['average']['rgb']['delta_e'] = necrotic_rgb_delta_e_total/necrotic_count
    self.aggregates['necrotic']['average']['lab']['delta_e'] = necrotic_lab_delta_e_total/necrotic_count

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

  # Set separation values between live and necrotic for each scoring method
  def set_separations(self):
    self.aggregates['separation'] = {
      'rgb': {},
      'lab': {}
    }

    rgb_keys = self.aggregates['live']['average']['rgb'].keys()
    lab_keys = self.aggregates['live']['average']['lab'].keys()

    for key in rgb_keys:
      live_avg = self.aggregates['live']['average']['rgb'][key]
      live_sd = self.aggregates['live']['standard_deviation']['rgb'][key]
      necrotic_avg = self.aggregates['necrotic']['average']['rgb'][key]
      necrotic_sd = self.aggregates['necrotic']['standard_deviation']['rgb'][key]
      separation = (necrotic_avg - live_avg)/math.sqrt((live_sd**2 + necrotic_sd**2)/2)

      self.aggregates['separation']['rgb'][key] = separation

    for key in lab_keys:
      live_avg = self.aggregates['live']['average']['lab'][key]
      live_sd = self.aggregates['live']['standard_deviation']['lab'][key]
      necrotic_avg = self.aggregates['necrotic']['average']['lab'][key]
      necrotic_sd = self.aggregates['necrotic']['standard_deviation']['lab'][key]
      separation = (necrotic_avg - live_avg)/math.sqrt((live_sd**2 + necrotic_sd**2)/2)

      self.aggregates['separation']['lab'][key] = separation

  # Set raw candidate values for all pixels in the blob
  def set_raw_injury_values(self):
    for data in self.pixel_data:
      rgb_r = data['rgb']['r']
      rgb_g = data['rgb']['g']
      rgb_b = data['rgb']['b']
      lab_l = data['lab']['l']
      lab_a = data['lab']['a']
      lab_b = data['lab']['b']

      data['raw'] = {
        'rgb': {
          'r': rgb_r,
          'g': rgb_g,
          'b': rgb_b,
          'r_minus_g': rgb_r - rgb_g,
          'r_minus_g_normalized': (rgb_r - rgb_g)/max(rgb_r + rgb_g + rgb_b, 1),
          'r_div_g': rgb_r/max(rgb_g, 1),
          'r_minus_avg_g_b': rgb_r - ((rgb_g + rgb_b)/2),
          'delta_e': math.sqrt((rgb_r - self.aggregates['live']['average']['rgb']['r'])**2 + (rgb_g - self.aggregates['live']['average']['rgb']['g'])**2 + (rgb_b - self.aggregates['live']['average']['rgb']['b'])**2),
        },
        'lab': {
          'l': lab_l,
          'a': lab_a,
          'b': lab_b,
          'a_plus_b': lab_a + lab_b,
          'delta_e': math.sqrt((lab_l - self.aggregates['live']['average']['lab']['l'])**2 + (lab_a - self.aggregates['live']['average']['lab']['a'])**2 + (lab_b - self.aggregates['live']['average']['lab']['b'])**2),
        }
      }

  # Set scores for all pixels in the blob
  def set_pixel_scores(self):
    # 95% live values from American, Chinese, and Hybrid baseline scans
    # threshold_95 = {
    #   'rgb': {
    #     'r': 33.7901988114855,
    #     'g': 27.9599046724105,
    #     'b': 3.78144550864443,
    #     'r_minus_g': 11.2747385835195,
    #     'r_minus_g_normalized': 0.0505488668181413,
    #     'r_div_g': 0.11699008225083700,
    #     'r_minus_avg_g_b': 18.586190387624800,
    #     'delta_e': 29.5497112714712,
    #   },
    #   'lab': {
    #     'l': 11.1530914975556,
    #     'a': 4.734533244056950,
    #     'b': 11.8368293563434,
    #     'a_plus_b': 11.9046959337337,
    #     'delta_e': 11.3061328019191,
    #   }
    # }
    threshold_95 = {
      'rgb': {
        'r': 0,
        'g': 0,
        'b': 0,
        'r_minus_g': 0,
        'r_minus_g_normalized': 0,
        'r_div_g': 0,
        'r_minus_avg_g_b': 0,
        'delta_e': 0,
      },
      'lab': {
        'l': 0,
        'a': 0,
        'b': 0,
        'a_plus_b': 0,
        'delta_e': 0,
      }
    }
    # Min value is 0 for actual use, -infinity for testing
    min_value = 0 #float('-inf')

    rgb_keys = self.pixel_data[0]['raw']['rgb'].keys()
    lab_keys = self.pixel_data[0]['raw']['lab'].keys()

    for data in self.pixel_data:
      data['scores'] = {
        'rgb': {},
        'lab': {}
      }

      for key in rgb_keys:
        # The raw value minus the live avg, since the damage is relative to what the live tissue started at
        scaled_value = data['raw']['rgb'][key] - self.aggregates['live']['average']['rgb'][key]
        # Threshold and trim to the min allowed value
        data['scores']['rgb'][key] = max(scaled_value - threshold_95['rgb'][key], min_value)
        # if scaled_value > threshold_95['rgb'][key]:
        #   data['scores']['rgb'][key] = scaled_value
        # else:
        #   data['scores']['rgb'][key] = 0

      for key in lab_keys:
        # The raw value minus the live avg
        scaled_value = data['raw']['lab'][key] - self.aggregates['live']['average']['lab'][key]
        # Threshold and trim to the min allowed value
        data['scores']['lab'][key] = max(scaled_value - threshold_95['lab'][key], min_value)
        # if scaled_value > threshold_95['lab'][key]:
        #   data['scores']['lab'][key] = scaled_value
        # else:
        #   data['scores']['lab'][key] = 0

  # Find the values at a given percent for all live pixel scoring methods
  def get_live_thresholds(self, portion):
    rgb_keys = self.pixel_data[0]['scores']['rgb'].keys()
    lab_keys = self.pixel_data[0]['scores']['lab'].keys()
    # Lists containing all the live values of each pixel score type
    lists = {
      'rgb': {},
      'lab': {}
    }
    for key in rgb_keys:
      lists['rgb'][key] = []

    for key in lab_keys:
      lists['lab'][key] = []

    for data in self.pixel_data:
      row = data['row']
      col = data['col']

      # Only count data for live pixels, set previously in set_avg_values
      if data.get('is_live'):
        for key in rgb_keys:
          lists['rgb'][key].append(data['scores']['rgb'][key])

        for key in lab_keys:
          lists['lab'][key].append(data['scores']['lab'][key])

    # Use the length of one since they are all the same
    position = int(len(lists['rgb']['r'])*portion)

    result = {
      'rgb': {},
      'lab': {}
    }

    for key in rgb_keys:
      result['rgb'][key] = sorted(lists['rgb'][key])[position]

    for key in lab_keys:
      result['lab'][key] = sorted(lists['lab'][key])[position]

    return result

  # Set all the candidate disk scores
  # Each candidate disk scoring method is run for each pixel scoring method
  def set_scores(self):
    rgb_keys = self.pixel_data[0]['scores']['rgb'].keys()
    lab_keys = self.pixel_data[0]['scores']['lab'].keys()

    for key in rgb_keys:
      self.scores['rgb'][key] = self.calculate_scores('rgb', key)

    for key in lab_keys:
      self.scores['lab'][key] = self.calculate_scores('lab', key)

  # Calculate the scores for the given pixel scoring method
  def calculate_scores(self, color_space, key):
    num_pixels = len(self.pixel_data)
    total = 0
    necrotic_count = 0

    for data in self.pixel_data:
      if data['is_live'] == False:
        total += data['scores'][color_space][key]
        necrotic_count += 1
        # TODO: Add to histogram bucket

    return {
      'avg': total/num_pixels, # Average of necrotic pixel values across all pixels
      'avg_of_necrotic': total/necrotic_count, # Average of necrotic pixel values across necrotic pixels
      'percent_necrotic': necrotic_count/num_pixels, # Percent of pixels that are necrotic

      # fixed_histogram # Necrotic pixels are counted into buckets, each with a fixed coefficient
      # best_fit_histogram # Necrotic pixels are counted into buckets, with best fit coefficients
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
    self.pixel_tags      = []
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
        if int(rgb[0]) + int(rgb[1]) + int(rgb[2]) <= 500:
          add_pixel_to_blobs(row, col, rgb, self.lab_image[row][col], self.dark_blobs)

    # Set the leaf disk blobs and group them into rows
    self.leaf_disk_blobs = [b for b in self.dark_blobs if b.is_leaf_disk()]
    if len(self.leaf_disk_blobs) == 0:
      raise 'No leaf disks found'

    self.set_leaf_disk_rows()

    # Calculate all the scores
    for blob in self.leaf_disk_blobs:
      blob.set_avg_values() # everything except delta e since it needs live avg rgb and lab as reference
      blob.set_raw_injury_values()
      blob.set_avg_delta_e()
      blob.set_standard_deviations()
      blob.set_separations()
      blob.set_pixel_scores()
      blob.set_scores()

      for data in blob.pixel_data:
        row = data['row']
        col = data['col']
        self.pixel_tags[row][col]['is_live'] = data['is_live']

      for portion in [0.95]:
        blob.thresholds['live'][str(portion)] = blob.get_live_thresholds(portion)
        # TODO: necrotic percentiles for histogram

    # Group the leaf disk blobs into rows
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

  # Create a csv of all candidate scores
  def scores_csv(self):
    rgb_keys = list(self.leaf_disk_blobs[0].scores['rgb'].keys())
    lab_keys = list(self.leaf_disk_blobs[0].scores['lab'].keys())
    disk_score_keys = list(self.leaf_disk_blobs[0].scores['rgb'][rgb_keys[0]].keys())
    file_name_no_ext = os.path.splitext(os.path.basename(self.file_path))[0]

    # Create the header row with all score keys
    headers = ['']

    for key in rgb_keys:
      headers += [f"rgb_{key}_{d_key}" for d_key in disk_score_keys]

    for key in lab_keys:
      headers += [f"lab_{key}_{d_key}" for d_key in disk_score_keys]

    lines = [','.join(headers)]

    # Populate with the leaf disk scores
    for row, disk_row in enumerate(self.rows):
      for col, blob in enumerate(disk_row):
        line = [f"{file_name_no_ext} R{row}C{col}"]

        for key in rgb_keys:
          line += [f"{blob.scores['rgb'][key][d_key]}" for d_key in disk_score_keys]

        for key in lab_keys:
          line += [f"{blob.scores['lab'][key][d_key]}" for d_key in disk_score_keys]

        lines.append(','.join(line))
      lines.extend(['']*10)

    return '\n'.join(lines)

  # Create a csv of thresholds for live pixels for pixel scoring methods
  def pixel_score_thresholds_csv(self):
    percentile_keys = list(self.leaf_disk_blobs[0].thresholds['live'].keys())
    rgb_keys = list(self.leaf_disk_blobs[0].thresholds['live'][percentile_keys[0]]['rgb'].keys())
    lab_keys = list(self.leaf_disk_blobs[0].thresholds['live'][percentile_keys[0]]['lab'].keys())
    file_name_no_ext = os.path.splitext(os.path.basename(self.file_path))[0]

    # Create the header row
    headers = ['']

    for key in rgb_keys:
      headers += [f"rgb_{key}_{p_key}" for p_key in percentile_keys]

    for key in lab_keys:
      headers += [f"lab_{key}_{p_key}" for p_key in percentile_keys]

    lines = [','.join(headers)]

    # Populate rows
    for row, disk_row in enumerate(self.rows):
      for col, blob in enumerate(disk_row):
        line = [f"{file_name_no_ext} Row {row} Col {col}"]

        for key in rgb_keys:
          line += [f"{blob.thresholds['live'][p_key]['rgb'][key]}" for p_key in percentile_keys]

        for key in lab_keys:
          line += [f"{blob.thresholds['live'][p_key]['lab'][key]}" for p_key in percentile_keys]

        lines.append(','.join(line))
      lines.append('')

    return '\n'.join(lines)

  # Create a csv of aggregate values for pixel scoring methods
  def pixel_score_aggregates_csv(self):
    rgb_keys = list(self.leaf_disk_blobs[0].aggregates['live']['average']['rgb'].keys())
    lab_keys = list(self.leaf_disk_blobs[0].aggregates['live']['average']['lab'].keys())
    file_name_no_ext = os.path.splitext(os.path.basename(self.file_path))[0]

    # Create the header row
    headers = ['']

    for key in rgb_keys:
      headers += [f"rgb_{key}_live_avg,rgb_{key}_live_st_dev"]
      headers += [f"rgb_{key}_necrotic_avg,rgb_{key}_necrotic_st_dev"]
      headers += [f"rgb_{key}_separation"]

    for key in lab_keys:
      headers += [f"lab_{key}_live_avg,lab_{key}_live_st_dev"]
      headers += [f"lab_{key}_necrotic_avg,lab_{key}_necrotic_st_dev"]
      headers += [f"lab_{key}_separation"]

    lines = [','.join(headers)]

    # Populate rows
    for row, disk_row in enumerate(self.rows):
      for col, blob in enumerate(disk_row):
        line = [f"{file_name_no_ext} R{row}C{col}"]

        for key in rgb_keys:
          line += [str(blob.aggregates['live']['average']['rgb'][key]), str(blob.aggregates['live']['standard_deviation']['rgb'][key])]
          line += [str(blob.aggregates['necrotic']['average']['rgb'][key]), str(blob.aggregates['necrotic']['standard_deviation']['rgb'][key])]
          line += [str(blob.aggregates['separation']['rgb'][key])]

        for key in lab_keys:
          line += [str(blob.aggregates['live']['average']['lab'][key]), str(blob.aggregates['live']['standard_deviation']['lab'][key])]
          line += [str(blob.aggregates['necrotic']['average']['lab'][key]), str(blob.aggregates['necrotic']['standard_deviation']['lab'][key])]
          line += [str(blob.aggregates['separation']['lab'][key])]

        lines.append(','.join(line))

    return '\n'.join(lines)

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

def main():
  output_dir = 'output'

  if len(sys.argv) < 2:
    print("Usage: python calcs.py image1.png [image2.png ...]")
    sys.exit(1)

  processed_images = []

  for file_path in sys.argv[1:]:
    base_file_name = os.path.basename(file_path)
    file_name_no_ext = os.path.splitext(base_file_name)[0]

    if not os.path.exists(file_path):
      print(f"File not found: {file_path}", file=sys.stderr)
      continue

    print(f"Processing {base_file_name}...")

    # Process and score the image
    image = LeafDiskImage(file_path)
    image.process_image()
    processed_images.append(image)

    # Write the scores csv
    scores_csv_path = f"{output_dir}/{file_name_no_ext}_scores.csv"
    write_file(scores_csv_path, image.scores_csv())
    print(f"  Saved scores csv: {scores_csv_path}")

    # TODO: Figure out best metric for initial use
    # TODO: do scores csv row x col, avg for a single metric
    # TODO: reprocess concentration x neutralization data (use calibration card in a different scan, then calibrate other images)
    # TODO:

    # Highlighted image
    highlighted_path = os.path.join(output_dir, f"{file_name_no_ext}_highlighted.png")
    image.get_highlighted_image().save(highlighted_path)
    print(f"  Saved highlighted image: {highlighted_path}")


    # Tests with proper time frame (1-4h)
    # * 4 solutions over time, right side up
    # * 4 solutions over time, upside down
    # * CA vs OA vs nOA
    # * First 90min
    # * Higher concentrations v2
    # * Many concentrations over time
    # * Neutralized oxalic acid
    # * Over time
    # * Y-intercept investigation

    # Tests with pH/concentration matrix
    # * 4 solutions over time, right side up
    # * 4 solutions over time, upside down
    # * American vs Chinese neutralized
    # * Big test different concentrations, pH
    # * Different percent neutralized
    # * Fine tune oxalate test, step 1
    # * Fine tune oxalate test, step 2
    # * Fine tune oxalate test, step 3
    # * Fine tune oxalate test, step 4
    # * Oxalate test best solution investigation
    # * Oxalate test different temp
    # * Oxalate test higher concentration
    # * Oxalate test over time
    # * Same pH
    # * Y-intercept investigation

  # # Write pixel score threshold values csv
  # content = ''
  # for image in processed_images:
  #   content += image.pixel_score_thresholds_csv()

  # pixel_score_thresholds_csv_path = f"{output_dir}/pixel_score_thresholds.csv"
  # write_file(pixel_score_thresholds_csv_path, content)
  # print(f"Saved pixel_score_thresholds csv: {pixel_score_thresholds_csv_path}")

  # Write pixel score aggregate values csv
  content = ''
  for image in processed_images:
    content += image.pixel_score_aggregates_csv()

  pixel_score_aggregates_csv_path = f"{output_dir}/pixel_score_aggregates.csv"
  write_file(pixel_score_aggregates_csv_path, content)
  print(f"Saved pixel_score_aggregates csv: {pixel_score_aggregates_csv_path}")

if __name__ == '__main__':
  main()
