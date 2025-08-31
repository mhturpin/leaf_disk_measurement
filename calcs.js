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
    this.darkBlobs = [];
    this.leafDiskBlobs = [];
    this.rows = [];
  }

  // Do all the image processing from loading the file to determining necrotic areas
  async processImage() {
    /* Load the image into the pixel array */
    let startTime = Date.now();
    let fileBase64 = await getFileContentsAsBase64(this.file);
    document.querySelector('img#originalImage').src = fileBase64;
    this.pixels = await base64ToPixels(fileBase64);
    console.log(`Load image: ${Date.now() - startTime}`);

    /* Find the dark blobs */
    forEachIJ(0, this.pixels.length - 1, 0, this.pixels[0].length - 1, (row, col) => {
      const pixel = this.pixels[row][col];

      // If the pixel is dark, match it to a blob or create a new one
      // If it touches two blobs, merge them
      if ((pixel.r + pixel.g) < 300) {
        // Mark the pixel as attributes
        pixel.isDark = true;
        pixel.isNecrotic = pixel.r > pixel.g;

        // Find blobs that touch the pixel
        const indices = this.findTouchingBlobIndices(row, col)

        switch (indices.length) {
          case 0:
            this.darkBlobs.push(new PixelBlob(row, col));
            break;
          case 1:
            this.darkBlobs[indices[0]].addPixel(row, col);
            break;
          case 2:
            // Merge blob 2 into blob 1
            this.darkBlobs[indices[0]].merge(this.darkBlobs[indices[1]]);
            // Remove blob 2 from the array
            this.darkBlobs.splice(indices[1], 1);
            // Add the pixel to blob 1
            this.darkBlobs[indices[0]].addPixel(row, col);
            break;
          default:
            throw `A pixel matched ${indices.length} blobs`
        }
      }
    });


    this.leafDiskBlobs = this.darkBlobs.filter(blob => blob.isLeafDisk());






    console.log()
    this.markBlobBorders();





    /* Find the edges */

    /* Find the necrotic boundaries */
    // startTime = Date.now();
    // this.setNecroticBoundaries();
    // this.setNecroticWidths();
    // console.log(`setNecroticBoundaries: ${Date.now() - startTime}`);


    // console.log('this.leafDiskEdges:');
    // console.log(this.leafDiskEdges);
  }
















  // Return a base64 data url encoding of the found edges converted to a visualization
  getHighlightedImage() {
    return pixelsToBase64(this.pixels, (pixel) => {
      let color = {r: pixel.r, g: pixel.g, b: pixel.b};

      // Mark dark pixels green
      if (pixel.isDark) color = {r: 0, g: 255, b: 0};

      // Mark necrotic pixels red
      if (pixel.isNecrotic) color = {r: 255, g: 0, b: 0};

      // Mark leaf disk boxes and row markers black
      if (pixel.isLeafDiskBox || pixel.isRowMarker) color = {r: 0, g: 0, b: 0};

      // Mark best fit circle white
      if (pixel.isBestFitCircle) color = {r: 255, g: 255, b: 255};

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
      const triangleScores = row.map(e => e.triangleScore);
      const avgTriangleScore = average(triangleScores).toFixed(4);

      data.push([i, ...triangleScores.map(p => p.toFixed(4)), avgTriangleScore].join(','));
    });

    this.setCsvLink(downloadLinkId, 'leaf_disk_data.csv', data);
  }

  // ==============
  // Helper methods
  // ==============

  // Return an array of indices of all blobs that touch the given pixel
  findTouchingBlobIndices(row, col) {
    return this.darkBlobs.reduce(function(indices, blob, i) {
      if (blob.touches(row, col)) indices.push(i);

      return indices;
    }, []);
  }

  // Mark blob borders on the image
  markBlobBorders() {
    for (const blob of this.leafDiskBlobs) {
      // Top and bottom box
      for (let col = blob.left; col <= blob.right; col++) {
        this.pixels[blob.top][col].isLeafDiskBox = true;
        this.pixels[blob.bottom][col].isLeafDiskBox = true;
      }

      // Left and right box
      for (let row = blob.top; row <= blob.bottom; row++) {
        this.pixels[row][blob.left].isLeafDiskBox = true;
        this.pixels[row][blob.right].isLeafDiskBox = true;
      }
    }
  }






  calculateTriangleScore(edge) {
    const radius = 94;
    let necroticCount = 0;
    const centerRow = (edge.top + edge.bottom)/2;
    const centerCol = (edge.left + edge.right)/2;

    // Counts of how many necrotic pixels are at each distance from the disk edge
    let countEdgeDistances = new Array(radius).fill(0)

    forEachIJ(edge.top, edge.bottom, edge.left, edge.right, (row, col) => {
      const pix = this.pixels[row][col];

      if (pix.r > pix.g && pix.r + pix.g < 300) {
        necroticCount++;

        const roundedDistance = radius - Math.round(this.distance(row, col, centerRow, centerCol));

        if (roundedDistance < radius) {
          countEdgeDistances[roundedDistance]++;
        }
      }
    });

    edge.necroticCount = necroticCount;
    edge.countEdgeDistances = countEdgeDistances;

    console.log('calculateTriangleScore')
    console.log(countEdgeDistances)

    const maxCount = Math.max(...countEdgeDistances);
    const startI = countEdgeDistances.findIndex(c => c === maxCount);
    countEdgeDistances = countEdgeDistances.slice(startI);
    // Use 20% of the max to cut off the tail, or 10% of the radius so that it doesn't use counts that are just noise
    const minCountCutoff = Math.max(maxCount*0.2, radius/10);
    const endI = countEdgeDistances.findIndex(c => c < minCountCutoff);
    countEdgeDistances = countEdgeDistances.slice(0, endI);

    console.log(maxCount)
    console.log(startI)
    console.log(countEdgeDistances)

    const linReg = this.linearRegression(countEdgeDistances.map((c, i) => ({x: i, y: c})));
    const xIntercept = -linReg.yIntercept/linReg.slope;

    edge.linReg = linReg;
    edge.triangleScore = xIntercept*linReg.yIntercept/2;
  }

  // Calculate linear regression https://codeforgeek.com/linear-regression-in-javascript/
  // x is the index, and y is the value of the data at the index
  linearRegression(data) {
    let xsum = 0;
    let ysum = 0;

    for (const {x, y} of data) {
      xsum += x;
      ysum += y;
    }

    const xmean = xsum / data.length;
    const ymean = ysum / data.length;

    let num = 0;
    let denom = 0;

    for (const {x, y} of data) {
      num += (x - xmean) * (y - ymean);
      denom += (x - xmean) * (x - xmean);
    }

    const m = num / denom
    const b = ymean - (m * xmean);
    const coefficients = {slope: m, yIntercept: b};

    return {...coefficients, rSquared: this.rSquared(data, coefficients)};
  }

  // https://stackoverflow.com/questions/65987106/how-do-i-calculate-r-squared-value-in-javascript
  rSquared(data, coefficients) {
    const yPrediction = (x) =>  + coefficients.slope*x + coefficients.yIntercept;
    let yMean = data.reduce((total, point) => total + point.y, 0)/data.length;
    let regressionSquaredError = 0;
    let totalSquaredError = 0;

    for (let i = 0; i < data.length; i++) {
      regressionSquaredError += (data[i].y - yPrediction(data[i].x))**2;
      totalSquaredError += (data[i].y - yMean)**2;
    }

    return 1 - (regressionSquaredError/totalSquaredError);
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

    for (const row of this.rows) {
      row.sort((a, b) => a.left - b.left);
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
// A class to handle pixel blob functions
/* ============================================== */
class PixelBlob {
  // Initialize with a single pixel
  constructor(row, col) {
    this.top = row;
    this.bottom = row;
    this.left = col;
    this.right = col;
    this.coordinates = [{row: row, col: col}];
  }

  // Returns true if the coordinates are contained by or adjacent to the blob
  touches(row, col) {
    const rowTouches = (this.top - 1) <= row && row <= (this.bottom + 1);
    const colTouches = (this.left - 1) <= col && col <= (this.right + 1);

    return rowTouches && colTouches;
  }

  // Adjust the boundaries if necessary and add the coordinates to the array
  addPixel(row, col) {
    if (!this.touches(row, col)) throw 'Pixel does not touch the blob';

    // Update the boundaries if necessary
    if (this.top > row) this.top = row;
    if (this.bottom < row) this.bottom = row;
    if (this.left > col) this.left = col;
    if (this.right < col) this.right = col;

    // Add the pixel to the coordinates array
    this.coordinates.push({row: row, col: col});
  }

  // Merge the blob into this one
  merge(blob) {
    // Merge boundaries
    this.top = Math.min(this.top, blob.top);
    this.bottom = Math.max(this.bottom, blob.bottom);
    this.left = Math.min(this.left, blob.left);
    this.right = Math.max(this.right, blob.right);

    // Merge the coordinate arrays
    this.coordinates = this.coordinates.concat(blob.coordinates);
  }

  // Returns the height of the blob
  height() {
    return this.bottom - this.top;
  }

  // Returns the width of the blob
  width() {
    return this.right - this.left;
  }

  // Returns the radius of the blob
  radius() {
    return (this.height() + this.width())/4;
  }

  // Returns true if the blob's height and width are roughly equal,
  // if it has roughly the number of dark pixels expected if it were circular,
  // and if the radius is greater than 25 (no image should be less than 80 dpi)
  isLeafDisk() {
    const isSquare = isWithinTolerance(this.height(), this.width(), 0.1);
    const expectedPixels = Math.PI*(this.radius()**2);
    const isCorrectNumberOfPixels = isWithinTolerance(expectedPixels, this.coordinates.length, 0.1);

    return isSquare && isCorrectNumberOfPixels && this.radius() > 25;
  }


  // ==============
  // Helper methods
  // ==============
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

// Determine if a number is within the given tolerance of another number
function isWithinTolerance(correctNum, num, tolerance) {
  return Math.abs(correctNum - num) < correctNum*tolerance;
}

// Calculate the distance between two points
function distance(row1, col1, row2, col2) {
  return Math.sqrt((row1 - row2)**2 + (col1 - col2)**2);
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
