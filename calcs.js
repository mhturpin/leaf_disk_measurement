/*
  Process:
  1. User uploads image
  2. Process the image
    a. Create pixel 2D array
    b. Find all the edges
    c. Determine which edges are leaf disks
    d. Assign each leaf disk to a row
    e. Find the best fit circles for the necrotic/living boundary
  3. Do calculations
  4. Display processed image
  5. Dispaly results and enable csv download button
*/

window.onload = function() {
  document.querySelector('input#imageUpload').onchange = async (e) => {
    const startTime = Date.now();

    // Process image
    image = new LeafDiskImage(e.target.files[0]);
    await image.processImage();

    // Show highlighted image
    // document.querySelector('img#highlightedImage').src = image.getEdgeImage();
    document.querySelector('img#highlightedImage').src = image.getHighlightedImage();

    // Set CSV files for download
    image.createDiskDataCsv('diskDataCsv');

    console.log(`Total time: ${Date.now() - startTime}`);
  }
}

/* ============================================== */
// A class to handle processing the leaf disk image
// and calculating values
/* ============================================== */
class LeafDiskImage {
  constructor(file) {
    this.file = file;
  }

  // Do all the image processing from loading the file to determining necrotic areas
  async processImage() {
    /* Load the image into the pixel array */
    let startTime = Date.now();
    let fileBase64 = await getFileContentsAsBase64(this.file);
    document.querySelector('img#originalImage').src = fileBase64;
    this.pixels = await base64ToPixels(fileBase64);
    console.log(`Load image: ${Date.now() - startTime}`);

    /* Set expected size for the leaf disks */
    // Assume the image is a 3" wide index card and the leaf disks are 5/8"
    this.expectedLeafDiskDiameter = (this.pixels[0].length/3)*5/8;

    /* Find the edges */
    startTime = Date.now();
    this.setLeafDiskEdges();
    console.log(`Find edges: ${Date.now() - startTime}`);

    /* Find the necrotic boundaries */
    startTime = Date.now();
    this.setNecroticBoundaries();
    this.setNecroticWidths();
    console.log(`setNecroticBoundaries: ${Date.now() - startTime}`);


    console.log('this.leafDiskEdges:');
    console.log(this.leafDiskEdges);
    // console.log('this.pixels:');
    // console.log(this.pixels);
  }

  // Return a base64 data url encoding of the found edges converted to a visualization
  getEdgeImage() {
    return this.diskEdgeFinder.getEdgeImage();
  }

  // Return a base64 data url encoding of the found edges converted to a visualization
  getHighlightedImage() {
    return pixelsToBase64(this.pixels, (pixel) => {
      let color = {r: pixel.r, g: pixel.g, b: pixel.b};

      if (pixel.r + pixel.g < 300) {
        if (pixel.r > pixel.g) {
          color.r *= 2;
          color.g /= 2;
        } else {
          color.g *= 2;
          color.r /= 2;
        }
      }

      // Mark leaf disk edges black
      if (pixel.isLeafDiskBox) {
        color = {r: 0, g: 0, b: 0};
      }

      // Mark leaf disk edges black
      if (pixel.isLeafDiskEdge) {
        color = {r: 0, g: 0, b: 0};
      }

      // Mark necrotic edges pink
      if (pixel.isNecroticEdge) {
        color = {r: 255, g: 0, b: 255};
      }

      // Mark best fit circle white
      if (pixel.isBestFitCircle) {
        color = {r: 255, g: 255, b: 255};
      }

      // Mark the row markers black
      if (pixel.isRowMarker) {
        color = {r: 0, g: 0, b: 0};
      }

      return color;
    });
  }

  // Create a csv of the individual leaf disk data and add it to the download button
  createDiskDataCsv(downloadLinkId) {
    const data = [];

    // Create a header row with numbers for each column
    const numColumns = Math.max(...this.rows.map(r => r.length));
    const headers = [...Array(numColumns+1).keys()].join(',').replace('0', '');
    data.push(headers + ',Average');

    this.rows.forEach((row, i) => {
      const necroticWidthPercentages = row.map(e => e.necroticWidthPercentage);
      const avgNecroticWidthPercentage = average(necroticWidthPercentages).toFixed(4);

      data.push([i, ...necroticWidthPercentages.map(p => p.toFixed(4)), avgNecroticWidthPercentage].join(','));
    });

    this.setCsvLink(downloadLinkId, 'leaf_disk_data.csv', data);
  }

  // ==============
  // Helper methods
  // ==============

  // Determine if an edge is a circle based on the ratio of height/width and the number of pixels
  isEdgeCircular({height, width, coordinates}) {
    const isSquare = this.isWithinTolerance(height, width, 0.1);
    const isCorrectDiameter = this.isWithinTolerance(this.expectedLeafDiskDiameter, width, 0.1);

    return isSquare && isCorrectDiameter;
  }

  // Determine if a number is within the given tolerance of another number
  isWithinTolerance(correctNum, num, tolerance) {
    return Math.abs(correctNum - num) < correctNum*tolerance;
  }

  // Find the edges of the leaf disks
  setLeafDiskEdges() {
    // Gradient value is the total pixel brightness
    this.diskEdgeFinder = new EdgeFinder(this.pixels, 500, 300, 2, ({r, g, b}) => r + g + b);
    this.diskEdgeFinder.findEdges(false);
    this.leafDiskEdges = structuredClone(this.diskEdgeFinder.edges.filter(e => this.isEdgeCircular(e)));

    // Group leaf disks into rows
    this.setLeafDiskRows();

    // Mark leaf disk edges so that we can access them easily when creating the highlighted image and find the average radius
    let dimensionSum = 0;

    for (const edge of this.leafDiskEdges) {
      dimensionSum += edge.bottom - edge.top;
      dimensionSum += edge.right - edge.left;

      // The actual edges
      for (const {row, col} of edge.coordinates) {
        this.pixels[row][col].isLeafDiskEdge = true;
      }

      // Top and bottom box
      for (let col = edge.left; col <= edge.right; col++) {
        this.pixels[edge.top][col].isLeafDiskBox = true;
        this.pixels[edge.bottom][col].isLeafDiskBox = true;
      }

      // Left and right box
      for (let row = edge.top; row <= edge.bottom; row++) {
        this.pixels[row][edge.left].isLeafDiskBox = true;
        this.pixels[row][edge.right].isLeafDiskBox = true;
      }
    }

    this.avgRadius = (dimensionSum/4)/this.leafDiskEdges.length;
  }

  setLeafDiskRows() {
    this.rows = [];

    for (const edge of this.leafDiskEdges) {
      let edgeRowAssigned = false;

      this.rows.forEach((row, i) => {
        const edgeVerticalMiddle = (edge.top + edge.bottom)/2;

        if (!edgeRowAssigned && row[0].top < edgeVerticalMiddle && row[0].bottom > edgeVerticalMiddle) {
          edgeRowAssigned = true;
          edge.rowGroup = i;
          row.push(edge);
        }
      });

      // Create a new row if it didn't match any existing ones
      if (!edgeRowAssigned) {
        edge.rowGroup = this.rows.length;
        this.rows.push([edge]);
      }
    }

    // Label the row marker pixels for use in the highlighted image
    this.labelRowGroups();
  }

  // Add corner markers to each blob to indicate which row it got grouped into
  labelRowGroups() {
    for (const edge of this.leafDiskEdges) {
      this.setRowMarkerBlocks(edge, edge.rowGroup + 1);
    }
  }

  // Draw the corner blocks for a single blob
  setRowMarkerBlocks(edge, number) {
    const blockSize = Math.round((edge.bottom-edge.top)/10);

    // Top left (1s)
    if (number%2 == 1) {
      this.setRowMarkerPixels(edge.top, edge.left, blockSize);
    }
    // Top right (2s)
    if (Math.floor(number/2)%2) {
      this.setRowMarkerPixels(edge.top, edge.right-blockSize, blockSize);
    }
    // Bottom left (4s)
    if (Math.floor(number/4)%2) {
      this.setRowMarkerPixels(edge.bottom-blockSize, edge.left, blockSize);
    }
    // Bottom right (8s)
    if (Math.floor(number/8)%2) {
      this.setRowMarkerPixels(edge.bottom-blockSize, edge.right-blockSize, blockSize);
    }
  }

  // Set row marker pixels starting at the given coordinates
  setRowMarkerPixels(startRow, startCol, size) {
    const endRow = startRow + size;
    const endCol = startCol + size;

    forEachIJ(startRow, endRow, startCol, endCol, (row, col) => {
      this.pixels[row][col].isRowMarker = true;
    });
  }

  // Find the boundaries of necrotic and live leaf tissue
  setNecroticBoundaries() {
    for (const leafDiskEdge of this.leafDiskEdges) {
      const leafDiskPixels = this.pixels.slice(leafDiskEdge.top, leafDiskEdge.bottom+1).map(row => row.slice(leafDiskEdge.left, leafDiskEdge.right+1));
      const boundaryFinder = new EdgeFinder(leafDiskPixels, 500, 200, 1, ({r, g}) => {
        // Pixels are necrotic if red > green
        // Group white background with necrotic so that only the edge between necrotic and live is found
        if (r > g || r + g > 300) {
          return 255*3;
        } else {
          return 0;
        }
      });

      boundaryFinder.findEdges(true);

      // Create a list of all necrotic boundary coordinates
      leafDiskEdge.necroticBoundaryCoordinates = [];
      boundaryFinder.edges.forEach(e => leafDiskEdge.necroticBoundaryCoordinates.push(...e.coordinates));

      // Mark necrotic edges so that we can access them easily when creating the highlighted image
      for (const edge of boundaryFinder.edges) {
        for (const {row, col} of edge.coordinates) {
          // The coordinates on the necrotic edge are relative to the leaf disk boundaries
          const originalRow = leafDiskEdge.top + row;
          const originalCol = leafDiskEdge.left + col;

          this.pixels[originalRow][originalCol].isNecroticEdge = true;
        }
      }
    }
  }

  // Find the best fit circles for the necrotic boundaries and set the necrotic width for each one
  setNecroticWidths() {
    for (const leafDiskEdge of this.leafDiskEdges) {
      this.findBestFitCircle(leafDiskEdge);
    }
  }

  // Find the cicles that best fit the line between live and necrotic tissue
  findBestFitCircle(leafDiskEdge) {
    // The center of the disk
    const centerRow = (leafDiskEdge.top + leafDiskEdge.bottom)/2;
    const centerCol = (leafDiskEdge.left + leafDiskEdge.right)/2;

    // Create an array of all the distances of necrotic edge pixels from the center
    const distances = leafDiskEdge.necroticBoundaryCoordinates.map(({row, col}) => this.distance(leafDiskEdge.top + row, leafDiskEdge.left + col, centerRow, centerCol));
    distances.sort((a, b) => a - b);

    // Count distances within +/- 1% of each integer
    const distanceGroups = {};
    const groupTolerance = Math.round(this.avgRadius*0.01);

    for (const d of distances) {
      const roundedDistance = Math.round(d);
      const start = roundedDistance - groupTolerance;
      const end = roundedDistance + groupTolerance;

      for (let i = start; i <= end; i++) {
        if (distanceGroups[i] === undefined) {
          distanceGroups[i] = 1;
        } else {
          distanceGroups[i] += 1;
        }
      }
    }

    // Find the distance group with the most members, this is our base value
    // The group with the most members will be the best fit circle
    let maxCount = 0;
    let mostCommonDistance = 0;

    for (const [key, value] of Object.entries(distanceGroups)) {
      if (maxCount < value) {
        maxCount = value;
        mostCommonDistance = parseInt(key);
      }
    }

    // Average all the distances within the group to get a more accurate value
    const bestFitDistances = distances.filter((d) => d > mostCommonDistance - groupTolerance && d < mostCommonDistance + groupTolerance);
    leafDiskEdge.liveRadius = average(bestFitDistances);
    leafDiskEdge.necroticWidth = this.avgRadius - leafDiskEdge.liveRadius;
    leafDiskEdge.necroticWidthPercentage = 100*leafDiskEdge.necroticWidth/this.avgRadius;

    // Set the best fit circle for the highlighted image
    this.setBestFitCircle(leafDiskEdge.liveRadius, centerRow, centerCol);
  }

  // Calculate the distance between two points
  distance(row1, col1, row2, col2) {
    return Math.sqrt((row1 - row2)**2 + (col1 - col2)**2);
  }

  // Mark the best fit circle with radius r and center row, col
  setBestFitCircle(r, centerRow, centerCol) {
    const steps = 1000;

    for (var i = 0; i < steps; i++) {
      const row = Math.round(centerRow + r*Math.sin(2*Math.PI*i/steps));
      const col = Math.round(centerCol + r*Math.cos(2*Math.PI*i/steps));

      this.pixels[row][col].isBestFitCircle = true;
    }
  }

  // Create a csv and make it the href for the download button identified by id
  setCsvLink(id, fileName, data) {
    const file = new Blob([data.join('\n')], {type: 'text/csv'});
    const a = document.getElementById(id);
    a.href = URL.createObjectURL(file);
    a.download = fileName;

  }
}


/* ============================================== */
// A class to handle edge finding processes
/* ============================================== */
class EdgeFinder {
  // Takes in a 2D array of pixels and a function used to calculate the gradient value
  constructor(pixels, strongThreshold, weakThreshold, edgeGroupingTolerance, calculatePixelValue) {
    this.pixels = structuredClone(pixels);
    this.height = this.pixels.length;
    this.width = this.pixels[0].length;
    this.edgeGroupingTolerance = edgeGroupingTolerance;
    this.calculatePixelValue = calculatePixelValue;
    this.strongThreshold = strongThreshold;
    this.weakThreshold = weakThreshold;
    this.strongGradientCoordinates = [];
    this.weakGradientCoordinates = [];
  }

  // Find all edges in the file using the Canny edge detection algorithm
  // https://en.wikipedia.org/wiki/Canny_edge_detector
  findEdges(useOutlierSuppression) {
    /* Calculate the gradient and angle for each pixel */
    // Set all the pixel values first so that we aren't recalculating them
    forEachIJ(0, this.height-1, 0, this.width-1, (row, col) => {
      this.pixels[row][col].value = this.calculatePixelValue(this.pixels[row][col]);
    });

    // Suppress live pixels within the necrotic area to help with circle finding
    if (useOutlierSuppression) {
      this.suppressOutliers();
    }

    // Calculate all sums of three pixels in the horizontal direction to avoid redoing calculations
    // The sum is saved on the center pixel
    forEachIJ(0, this.height-1, 0, this.width-1, (row, col) => {
      this.pixels[row][col].rowSumOfThree = this.sumPixelValues(row, row, col-1, col+1);
      this.pixels[row][col].colSumOfThree = this.sumPixelValues(row-1, row+1, col, col);
    });
    // Use .bind(this) so that the function has the context when it is called
    forEachIJ(0, this.height-1, 0, this.width-1, this.setGradientValues.bind(this));

    /* If the pixel gradient is not the maximum of the 3 in line with the gradient direction, set it to 0 */
    // This ensures that we only have one pixel per edge
    // Thresholding done when setting the pixel gradients to improve performance
    for (const {row, col} of this.weakGradientCoordinates) {
      if (!this.isMaxGradient(row, col)) {
        this.pixels[row][col].gradient = 0;
      }
    }

    for (const {row, col} of this.strongGradientCoordinates) {
      if (!this.isMaxGradient(row, col)) {
        this.pixels[row][col].gradient = 0;
      }
    }

    /* Create the coordinate arrays for all the connected edges */
    this.groupContinuousEdges();
  }

  // Return a base64 data url encoding of the gradients converted to a visualization
  // Edges will be white and everything else black
  getEdgeImage() {
    return pixelsToBase64(this.pixels, ({isGrouped}) => {
      let color = {r: 0, g: 0, b: 0};

      // Only show pixels that have been determined to belong to an edge
      if (isGrouped) {
        color = {r: 255, g: 255, b: 255};
      }
      // let color = {r: gradient/3, g: gradient/3, b: gradient/3};

      return color;
    });
  }

  // Return a base64 data url encoding of the gradients converted to a visualization
  // Edges will be white and everything else black
  getValueImage() {
    return pixelsToBase64(this.pixels, ({value}) => {
      let color = {r: value/3, g: value/3, b: value/3};

      return color;
    });
  }

  // ==============
  // Helper methods
  // ==============
  // Smooth the image to reduce noise
  smoothImage() {
    forEachIJ(0, this.height-1, 0, this.width-1, (row, col) => {
      const scaledValues = forEachIJ(-2, 2, -2, 2, (i, j) => {
        const {value} = this.getPixel(row + i, col + j);
        return this.scaleValue(value, i, j);
      });

      this.pixels[row][col].value = Math.round(scaledValues.reduce((sum, value) => sum + value, 0));
    });
  }

  // Use the gaussian filter to scale the value
  scaleValue(value, i, j) {
    const filter = [
      [2, 4, 5, 4, 2],
      [4, 9, 12, 9, 4],
      [5, 12, 15, 12, 5],
      [4, 9, 12, 9, 4],
      [2, 4, 5, 4, 2]
    ];
    const total = 159;

    return value*filter[i+2][j+2]/total;
  }

  // Set pixel value to the max value if the majority of pixels around it also have a high value
  suppressOutliers() {
    forEachIJ(0, this.height-1, 0, this.width-1, (row, col) => {
      const maxValue = 255*3;
      const neighborValues = forEachIJ(-2, 2, -2, 2, (i, j) => this.getPixel(row + i, col + j).value);

      if (this.pixels[row][col].value === 0 && neighborValues.filter(v => v === maxValue).length > 12) {
        this.pixels[row][col].value = maxValue;
      }
    });
  }

  // Return the pixel, or if the coordinates are out of bounds, return the nearest pixel
  getPixel(row, col) {
    if (row < 0) {
      row = 0;
    } else if (row >= this.height) {
      row = this.height-1;
    }

    if (col < 0) {
      col = 0;
    } else if (col >= this.width) {
      col = this.width-1;
    }

    return this.pixels[row][col];
  }

  // Calculate and set the gradient and angle (converted to degrees and rounded to the nearest 45)
  setGradientValues(row, col) {
    const sumTop = this.getPixel(row-1, col).rowSumOfThree;
    const sumBottom = this.getPixel(row+1, col).rowSumOfThree;
    const verticalGradient = sumTop - sumBottom;
    const sumLeft = this.getPixel(row, col-1).colSumOfThree;
    const sumRight = this.getPixel(row, col+1).colSumOfThree;
    const horizontalGradient = sumLeft - sumRight;
    const totalGradient = Math.sqrt(verticalGradient**2 + horizontalGradient**2);

    // Only set gradients for pixels above the weakThreshold to save time later
    if (totalGradient > this.weakThreshold) {
      // If the pixel is strong or weak, add it to the proper list
      if (totalGradient > this.strongThreshold) {
        this.strongGradientCoordinates.push({row: row, col: col});
      } else if (totalGradient > this.weakThreshold) {
        this.weakGradientCoordinates.push({row: row, col: col});
      }

      // Set the values on the pixel
      this.pixels[row][col].gradient = totalGradient;
      const angleDegrees = Math.atan(verticalGradient/horizontalGradient)*180/Math.PI;
      this.pixels[row][col].gradientAngle = Math.round(angleDegrees/45)*45;
    }
  }

  // Get the sum of all pixel brightnesses for the given ranges (inclusive)
  // If the range goes out of bounds, it'll use the pixel on the edge
  sumPixelValues(startRow, endRow, startCol, endCol) {
    const values = forEachIJ(startRow, endRow, startCol, endCol, (row, col) => {
      return this.getPixel(row, col).value;
    });

    return values.reduce((sum, gradient) => sum + gradient, 0);
  }

  // Check if the pixel at row, col has a larger gradient value than its neighbors in line with the gradient direction
  isMaxGradient(row, col) {
    const angle = this.pixels[row][col].gradientAngle;
    let neighborGradients;

    if (angle === 0) {
      // left to right direction
      neighborGradients = [this.pixels[row]?.[col-1]?.gradient, this.pixels[row]?.[col+1]?.gradient];
    } else if (angle === 45) {
      // upper left to lower right direction
      neighborGradients = [this.pixels[row-1]?.[col-1]?.gradient, this.pixels[row+1]?.[col+1]?.gradient];
    } else if (angle === -45) {
      // lower left to upper right direction
      neighborGradients = [this.pixels[row-1]?.[col+1]?.gradient, this.pixels[row+1]?.[col-1]?.gradient];
    } else {
      // top to bottom direction
      neighborGradients = [this.pixels[row-1]?.[col]?.gradient, this.pixels[row+1]?.[col]?.gradient];
    }

    // Filter out undefined if the neighbor doesn't exist (the pixel is on the edge of the image)
    return this.pixels[row][col].gradient > Math.max(...neighborGradients.filter((g) => typeof g === 'number'));
  }

  // Loop through all the strong gradient pixels and group them into continuous edges
  // Set this.edges to an array of coordinate arrays, each coordinate array representing one continuous edge
  groupContinuousEdges() {
    this.edges = [];

    for (const {row, col} of this.strongGradientCoordinates) {
      // If the pixel has not yet been put in a group and hasn't been zeroed out, then group it and all the ones connected to it
      if (!this.pixels[row][col].isGrouped && this.pixels[row][col].gradient !== 0) {
        const connectedPixels = this.findConnectedEdgePixels(row, col, this.edges.length);

        // Ignore edges that are too short
        if (connectedPixels.length < 20) {
          continue;
        }

        const edgeRows = connectedPixels.map(p => p.row);
        const edgeCols = connectedPixels.map(p => p.col);
        const newEdge = {
          top: Math.min(...edgeRows),
          bottom: Math.max(...edgeRows),
          left: Math.min(...edgeCols),
          right: Math.max(...edgeCols),
          coordinates: connectedPixels
        }
        newEdge.height = newEdge.bottom - newEdge.top;
        newEdge.width = newEdge.right - newEdge.left;

        this.edges.push(newEdge);
      }
    }
  }

  // Return a coordinate array of all edge pixels connected to the pixel at the given coordinates
  // The edgeIndex parameter identifies which edge the pixel is getting grouped into
  findConnectedEdgePixels(row, col, edgeIndex) {
    if (!this.isUngroupedWeakPixel(row, col)) {
      throw new Error('findConnectedEdgePixels called with invalid pixel');
    } else {
      // Mark the pixel as grouped so that we don't process it again
      this.pixels[row][col].isGrouped = true;
      this.pixels[row][col].edgeIndex = edgeIndex;

      // Return an array including the current coordinates and all the neighboring edge pixels
      // Allow for gaps of 1px in case the edge has a discontinuity
      const pixelList = [{row: row, col: col}];
      const egt = this.edgeGroupingTolerance;

      forEachIJ(row - egt, row + egt, col - egt, col + egt, (i, j) => {
        if (this.isUngroupedWeakPixel(i, j)) {
          pixelList.push(...this.findConnectedEdgePixels(i, j, edgeIndex));
        }
      });

      return pixelList;
    }
  }

  // Return true if the pixel is valid, is above the weak threshold, and is ungrouped
  isUngroupedWeakPixel(row, col) {
    return this.pixels[row]?.[col] !== undefined && this.pixels[row][col].gradient > this.weakThreshold && !this.pixels[row][col].isGrouped;
  }
}

// Calls the function with each row and col for the given ranges
// Indices are inclusive
function forEachIJ(startI, endI, startJ, endJ, doSomething) {
  const values = [];

  for (let i = startI; i <= endI; i++) {
    for (let j = startJ; j <= endJ; j++) {
      // Use .bind(this) because otherwise the passed in function does not have the context
      values.push(doSomething(i, j));
    }
  }

  return values;
}

// Average an array of numbers
function average(array) {
  return array.reduce((sum, value) => sum + value, 0)/array.length;
}


/* ============================================== */
// Image conversion functions
/* ============================================== */
// Load the file contents as a base64 data url
function getFileContentsAsBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    // Set the callback to resolve with the base64 file contents
    reader.onloadend = () => resolve(reader.result);
    // Read the file, which triggers the callback when it's done
    reader.readAsDataURL(file);
  });
}

// Convert the base64 data url file contents to a 2D array of pixels with rgb values
function base64ToPixels(base64) {
  return new Promise((resolve) => {
    const img = new Image();

    // Set the callback to convert the image to pixels
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.height = img.height;
      canvas.width = img.width;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // imageData.data is a flattened array of all the pixel values
      // 4 values represents 1 pixel (r, g, b, a)
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      // Initialize pixels based on height and width
      const pixels = Array(imageData.height);

      for (let row = 0; row < imageData.height; row++) {
        pixels[row] = [];

        for (let col = 0; col < imageData.width; col++) {
          const pixelNum = row*imageData.width + col;
          const data = imageData.data.slice(pixelNum*4, pixelNum*4 + 3);

          pixels[row][col] = {r: data[0], g: data[1], b: data[2]};
        }
      }

      // Resolve the promise with the pixels array
      resolve(pixels);
    };

    // Load the image and trigger the onload function
    img.src = base64;
  });
}

// Converts the pixels into a base64 data URL
// Takes a transformation that returns an object with keys r, g, and b
function pixelsToBase64(pixels, transformation) {
  const height = pixels.length;
  const width = pixels[0].length;
  const imageData = new ImageData(width, height);

  // Populate imageData with pixel values
  forEachIJ(0, pixels.length-1, 0, pixels[0].length-1, (row, col) => {
    const {r, g, b} = transformation(pixels[row][col]);
    const pixelNum = row*width + col;

    imageData.data[pixelNum*4] = r;
    imageData.data[pixelNum*4 + 1] = g;
    imageData.data[pixelNum*4 + 2] = b;
    imageData.data[pixelNum*4 + 3] = 255; // Alpha
  });

  const canvas = document.createElement('canvas');
  canvas.height = imageData.height;
  canvas.width = imageData.width;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL();
}
