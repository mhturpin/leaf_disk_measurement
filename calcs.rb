#!/usr/bin/env ruby
# Usage: ruby calcs.rb image1.png [image2.png ...]

require 'chunky_png'

# ============================================== #
# Utility functions (top-level, available everywhere)
# ============================================== #

def for_each_ij(start_i, end_i, start_j, end_j, &block)
  (start_i..end_i).each do |i|
    (start_j..end_j).each do |j|
      block.call(i, j)
    end
  end
end

def within_tolerance?(correct_num, num, tolerance)
  (correct_num - num).abs < correct_num * tolerance
end

def point_distance(row1, col1, row2, col2)
  Math.sqrt((row1 - row2)**2 + (col1 - col2)**2)
end

def real_number?(num)
  num.is_a?(Numeric) && !(num.respond_to?(:nan?) && num.nan?) && !(num.respond_to?(:infinite?) && num.infinite?)
end

def sum_real(array)
  array.reduce(0) { |s, v| real_number?(v) ? s + v : s }
end

def average(array)
  real = array.select { |v| real_number?(v) }
  return 0.0 if real.empty?
  real.sum.to_f / real.length
end

def r_squared(data, coefficients)
  y_pred = ->(x) { coefficients[:slope] * x + coefficients[:y_intercept] }
  y_mean = data.sum { |p| p[:y] } / data.length.to_f
  regression_sq_err = 0.0
  total_sq_err = 0.0

  data.each do |p|
    regression_sq_err += (p[:y] - y_pred.call(p[:x]))**2
    total_sq_err += (p[:y] - y_mean)**2
  end

  1 - (regression_sq_err / total_sq_err)
end

def linear_regression(data)
  xmean = data.sum { |p| p[:x] } / data.length.to_f
  ymean = data.sum { |p| p[:y] } / data.length.to_f

  num = 0.0
  denom = 0.0
  data.each do |p|
    num   += (p[:x] - xmean) * (p[:y] - ymean)
    denom += (p[:x] - xmean)**2
  end

  slope = num / denom
  y_intercept = ymean - slope * xmean
  coefficients = { slope: slope, y_intercept: y_intercept }
  coefficients[:r_squared] = r_squared(data, coefficients)
  coefficients
end


# ============================================== #
# PixelBlob class
# ============================================== #

class PixelBlob
  attr_accessor :top, :bottom, :left, :right,
                :coordinates, :necrotic_coordinates, :live_coordinates,
                :row_group, :avg_necrotic_value_sum

  def initialize
    @top    =  Float::INFINITY
    @bottom = -Float::INFINITY
    @left   =  Float::INFINITY
    @right  = -Float::INFINITY
    @coordinates          = []
    @necrotic_coordinates = []
    @live_coordinates     = []
    @row_group = nil
    @avg_necrotic_value_sum = nil
  end

  def touches(row, col)
    (@top - 1) <= row && row <= (@bottom + 1) &&
      (@left - 1) <= col && col <= (@right + 1)
  end

  def add_pixel(row, col, is_necrotic)
    @top    = row if @top    > row
    @bottom = row if @bottom < row
    @left   = col if @left   > col
    @right  = col if @right  < col

    @coordinates << { row: row, col: col }
    if is_necrotic
      @necrotic_coordinates << { row: row, col: col }
    else
      @live_coordinates << { row: row, col: col }
    end
  end

  def merge(blob)
    @top    = [@top,    blob.top   ].min
    @bottom = [@bottom, blob.bottom].max
    @left   = [@left,   blob.left  ].min
    @right  = [@right,  blob.right ].max

    @coordinates          += blob.coordinates
    @necrotic_coordinates += blob.necrotic_coordinates
    @live_coordinates     += blob.live_coordinates
  end

  def height = @bottom - @top
  def width  = @right  - @left
  def radius = (height + width) / 4.0

  def center_coordinates
    { center_row: (@bottom + @top) / 2.0, center_col: (@right + @left) / 2.0 }
  end

  def leaf_disk?
    is_square           = within_tolerance?(height, width, 0.1)
    expected_pixels     = Math::PI * radius**2
    correct_pixel_count = within_tolerance?(expected_pixels, @coordinates.length, 0.1)
    is_square && correct_pixel_count && radius > 50
  end
end


# ============================================== #
# LeafDiskImage class
# ============================================== #

class LeafDiskImage
  attr_reader :rows, :avg_radius, :slope_score_linear_regression

  def initialize(file_path)
    @file_path       = file_path
    @dark_blobs      = []
    @leaf_disk_blobs = []
    @rows            = []
    @pair_scores_csv = nil
  end

  def process_image
    @pixels = load_pixels(@file_path)
    height  = @pixels.length
    width   = @pixels[0].length

    # Find dark blobs
    for_each_ij(0, height - 1, 0, width - 1) do |row, col|
      pixel = @pixels[row][col]
      next unless pixel[:r] + pixel[:g] + pixel[:b] < 500

      pixel[:is_dark]     = true
      pixel[:is_necrotic] = pixel[:r] > pixel[:g]

      indices = find_touching_blob_indices(row, col)

      matching_blob = case indices.length
      when 0
        blob = PixelBlob.new
        @dark_blobs << blob
        blob
      when 1
        @dark_blobs[indices[0]]
      when 2
        blob = @dark_blobs[indices[0]]
        blob.merge(@dark_blobs[indices[1]])
        @dark_blobs.delete_at(indices[1])
        blob
      else
        raise "A pixel matched #{indices.length} blobs"
      end

      matching_blob.add_pixel(row, col, pixel[:is_necrotic])
    end

    @leaf_disk_blobs = @dark_blobs.select(&:leaf_disk?)
    label_blob_borders
    set_leaf_disk_rows
    set_avg_radius

    @leaf_disk_blobs.each { |blob| calculate_disk_score(blob) }

    @slope_score_linear_regression = calculate_slope_score
    calculate_pair_slope_scores
  end

  def get_highlighted_image
    height = @pixels.length
    width  = @pixels[0].length
    png    = ChunkyPNG::Image.new(width, height)

    for_each_ij(0, height - 1, 0, width - 1) do |row, col|
      pixel = @pixels[row][col]
      r, g, b = pixel[:r], pixel[:g], pixel[:b]

      if pixel[:is_dark]
        v = ((pixel[:r] - pixel[:g] + 50) * 255.0 / 100).clamp(0, 255).to_i
        r, g, b = v, v, v
      end

      r, g, b = 0, 0, 0     if pixel[:is_leaf_disk_box] || pixel[:is_row_marker]
      r, g, b = 255, 255, 255 if pixel[:is_best_fit_circle]

      png[col, row] = ChunkyPNG::Color.rgb(r, g, b)
    end

    png
  end

  def disk_data_csv
    num_columns = @rows.map(&:length).max || 0
    headers = [''] + (1..num_columns).map(&:to_s) + ['Average']
    lines = [headers.join(',')]

    @rows.each_with_index do |row, i|
      values  = row.map(&:avg_necrotic_value_sum)
      avg_val = average(values).round(2)
      lines << ([i] + values.map { |v| v.round(2) } + [avg_val]).join(',')
    end

    lines
  end

  def pair_scores_csv = @pair_scores_csv

  private

  def load_pixels(file_path)
    png    = ChunkyPNG::Image.from_file(file_path)
    pixels = Array.new(png.height) { Array.new(png.width) }

    png.height.times do |row|
      png.width.times do |col|
        color = png[col, row]
        pixels[row][col] = {
          r: ChunkyPNG::Color.r(color),
          g: ChunkyPNG::Color.g(color),
          b: ChunkyPNG::Color.b(color)
        }
      end
    end

    pixels
  end

  def find_touching_blob_indices(row, col)
    @dark_blobs.each_with_index.each_with_object([]) do |(blob, i), indices|
      indices << i if blob.touches(row, col)
    end
  end

  def label_blob_borders
    @leaf_disk_blobs.each do |blob|
      (blob.left..blob.right).each do |col|
        @pixels[blob.top][col][:is_leaf_disk_box]    = true
        @pixels[blob.bottom][col][:is_leaf_disk_box] = true
      end
      (blob.top..blob.bottom).each do |row|
        @pixels[row][blob.left][:is_leaf_disk_box]  = true
        @pixels[row][blob.right][:is_leaf_disk_box] = true
      end
    end
  end

  def set_leaf_disk_rows
    @rows = []

    @leaf_disk_blobs.each do |blob|
      assigned = false

      @rows.each_with_index do |row, i|
        mid = blob.center_coordinates[:center_row]
        if !assigned && row[0].top < mid && row[0].bottom > mid
          assigned = true
          blob.row_group = i
          row << blob
        end
      end

      unless assigned
        blob.row_group = @rows.length
        @rows << [blob]
      end
    end

    @rows.each { |row| row.sort_by!(&:left) }
    label_row_groups
  end

  def label_row_groups
    @leaf_disk_blobs.each { |blob| label_row_marker_blocks(blob, blob.row_group + 1) }
  end

  def label_row_marker_blocks(blob, number)
    block_size = ((blob.bottom - blob.top) / 10.0).round
    label_row_marker_pixels(blob.top,                blob.left,              block_size) if number % 2 == 1
    label_row_marker_pixels(blob.top,                blob.right - block_size, block_size) if (number / 2).floor % 2 == 1
    label_row_marker_pixels(blob.bottom - block_size, blob.left,              block_size) if (number / 4).floor % 2 == 1
    label_row_marker_pixels(blob.bottom - block_size, blob.right - block_size, block_size) if (number / 8).floor % 2 == 1
  end

  def label_row_marker_pixels(start_row, start_col, size)
    for_each_ij(start_row, start_row + size, start_col, start_col + size) do |row, col|
      @pixels[row][col][:is_row_marker] = true
    end
  end

  def set_avg_radius
    @avg_radius = average(@leaf_disk_blobs.map(&:radius))
  end

  def calculate_disk_score(blob)
    rad        = (blob.radius * 1.1).round
    center     = blob.center_coordinates
    center_row = center[:center_row]
    center_col = center[:center_col]

    pixel_counts       = Array.new(rad)
    rg_diff_sums       = Array.new(rad)
    necrotic_value_sums = Array.new(rad)

    blob.coordinates.each do |coord|
      row, col = coord[:row], coord[:col]
      d = point_distance(row, col, center_row, center_col).round
      next unless d >= 0 && d < rad

      if pixel_counts[d].nil?
        pixel_counts[d]        = 0
        rg_diff_sums[d]        = 0
        necrotic_value_sums[d] = 0
      end

      r = @pixels[row][col][:r]
      g = @pixels[row][col][:g]
      pixel_counts[d]        += 1
      rg_diff_sums[d]        += r - g
      necrotic_value_sums[d] += r - g
    end

    real_sums       = rg_diff_sums.select { |s| real_number?(s) }
    min_sum         = real_sums.min
    necrotic_extent = rg_diff_sums.index(min_sum)

    avgs = necrotic_value_sums.map.with_index do |s, i|
      (s && pixel_counts[i] && pixel_counts[i] > 0) ? s.to_f / pixel_counts[i] : nil
    end

    min_avg = avgs[necrotic_extent]
    avgs    = avgs.map { |v| v ? v - min_avg : nil }

    blob.avg_necrotic_value_sum = sum_real(avgs[necrotic_extent..] || [])
  end

  def calculate_slope_score
    unless @rows.length == 4
      puts "  Note: #{@rows.length} rows found (expected 4), skipping slope score."
      return nil
    end

    log_concentrations = [Math.log10(8), Math.log10(12), Math.log10(14), Math.log10(16)]
    data = @rows.map.with_index do |row, i|
      { x: log_concentrations[i], y: average(row.map(&:avg_necrotic_value_sum)) }
    end

    linear_regression(data)
  end

  def calculate_pair_slope_scores
    unless @rows.length.even?
      puts "  Note: #{@rows.length} rows found (odd number), skipping pair slope scores."
      return
    end

    log_concentrations = [Math.log10(8), Math.log10(16)]
    lines = [',Leaf 1,Leaf 2,Leaf 3,Average']

    (0...@rows.length).step(2) do |i|
      sums1 = @rows[i].map(&:avg_necrotic_value_sum)
      sums2 = @rows[i + 1].map(&:avg_necrotic_value_sum)

      pair_scores = sums1.each_with_index.map do |rate, j|
        linear_regression([
          { x: log_concentrations[0], y: rate },
          { x: log_concentrations[1], y: sums2[j] }
        ])[:slope]
      end

      pair_scores << average(pair_scores)
      row_line = ["Tree #{i / 2}"] + pair_scores.map { |s| s.round(3) }
      lines << row_line.join(',')
    end

    @pair_scores_csv = lines
  end
end


# ============================================== #
# Main
# ============================================== #

if ARGV.empty?
  puts "Usage: ruby calcs.rb image1.png [image2.png ...]"
  exit 1
end

slope_score_rows = ['File Name,Slope Score,R Squared']

ARGV.each do |file_path|
  unless File.exist?(file_path)
    warn "File not found: #{file_path}"
    next
  end

  puts "Processing #{file_path}..."

  image = LeafDiskImage.new(file_path)
  image.process_image

  base = File.basename(file_path, '.*')
  dir  = File.dirname(file_path)

  # Highlighted image
  highlighted_path = File.join(dir, "#{base}_highlighted.png")
  image.get_highlighted_image.save(highlighted_path)
  puts "  Saved highlighted image: #{highlighted_path}"

  # Disk data CSV
  disk_csv_path = File.join(dir, "#{base}_avgNecroticValueSums.csv")
  File.write(disk_csv_path, image.disk_data_csv.join("\n"))
  puts "  Saved disk data CSV:     #{disk_csv_path}"

  # Pair scores CSV
  if image.pair_scores_csv
    pair_csv_path = File.join(dir, "#{base}_pairScores.csv")
    File.write(pair_csv_path, image.pair_scores_csv.join("\n"))
    puts "  Saved pair scores CSV:   #{pair_csv_path}"
  end

  # Slope score
  if (reg = image.slope_score_linear_regression)
    puts "  Slope:       #{reg[:slope].round(2)}"
    puts "  Y-Intercept: #{reg[:y_intercept].round(2)}"
    puts "  R²:          #{reg[:r_squared].round(2)}"
    slope_score_rows << [File.basename(file_path), reg[:slope].round(2), reg[:r_squared].round(2)].join(',')
  end

  puts "  Average radius: #{image.avg_radius.round(2)} px"
  puts "  Rows: #{image.rows.map(&:length).inspect}"
end

# Combined slope scores CSV (always written, even if empty)
slope_csv_path = File.join(Dir.pwd, 'slopeScores.csv')
File.write(slope_csv_path, slope_score_rows.join("\n"))
puts "\nSaved combined slope scores: #{slope_csv_path}"
