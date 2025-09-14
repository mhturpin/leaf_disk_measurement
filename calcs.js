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
    const results = ['File Name,Slope Score,R Squared'];

    for (const file of e.target.files) {
      // Process image
      image = new LeafDiskImage(file);
      await image.processImage();

      // Add the score to the csv
      results.push([
        file.name,
        image.slopeScoreLinearRegression.slope.toFixed(2),
        image.slopeScoreLinearRegression.rSquared.toFixed(2)
      ].join(','));

      // Show highlighted image
      // document.querySelector('img#highlightedImage').src = image.getEdgeImage();
      document.querySelector('img#highlightedImage').src = image.getHighlightedImage();

      // Set CSV files for download
      image.createDiskDataCsv('avgNecroticValueSum', 'avgNecroticValueSumsCsv');

      // Display slope score
      if (image.slopeScoreLinearRegression !== undefined) {
        setText('slope', image.slopeScoreLinearRegression.slope.toFixed(2));
        setText('yIntercept', image.slopeScoreLinearRegression.yIntercept.toFixed(2));
        setText('rSquared', image.slopeScoreLinearRegression.rSquared.toFixed(2));
      }

      console.log('Leaf disk rows:');
      console.log(image.rows);
      console.log(`Average radius: ${image.avgRadius}`);
    }

    // Create the csv download for all the slope scores
    setCsvLink('slopeScoresCsv', `slopeScores.csv`, results);
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
    let fileBase64 = await getFileContentsAsBase64(this.file);
    document.querySelector('img#originalImage').src = fileBase64;
    this.pixels = await base64ToPixels(fileBase64);

    /* Find the dark blobs */
    forEachIJ(0, this.pixels.length - 1, 0, this.pixels[0].length - 1, (row, col) => {
      const pixel = this.pixels[row][col];

      // If the pixel is dark, match it to a blob or create a new one
      // If it touches two blobs, merge them
      if ((pixel.r + pixel.g + pixel.b) < 600) {
        // Mark the pixel as attributes
        pixel.isDark = true;
        pixel.isNecrotic = pixel.r > pixel.g;

        // Find blobs that touch the pixel
        const indices = this.findTouchingBlobIndices(row, col);
        let matchingBlob;

        switch (indices.length) {
          case 0:
            // If there are no matches, create a new blob
            matchingBlob = new PixelBlob();
            this.darkBlobs.push(matchingBlob);
            break;
          case 1:
            // If there is only one match use that
            matchingBlob = this.darkBlobs[indices[0]];
            break;
          case 2:
            // If there are two matches, merge them
            matchingBlob = this.darkBlobs[indices[0]];
            matchingBlob.merge(this.darkBlobs[indices[1]]);
            this.darkBlobs.splice(indices[1], 1);
            break;
          default:
            throw `A pixel matched ${indices.length} blobs`
        }

        matchingBlob.addPixel(row, col, pixel.isNecrotic);
      }
    });

    /* Set the leaf disk blobs and group into rows */
    this.leafDiskBlobs = this.darkBlobs.filter(blob => blob.isLeafDisk());
    this.labelBlobBorders();
    this.setLeafDiskRows();
    this.setAvgRadius();

    /* Calculate the scores */
    for (const blob of this.leafDiskBlobs) {
      this.calculateDiskScore(blob);
    }

    this.slopeScoreLinearRegression = this.calculateSlopeScore();
    this.calculatePairSlopeScores();
  }

  // Return a base64 data url encoding of the processed image converted to a visualization
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
  createDiskDataCsv(dataName, downloadLinkId) {
    const data = [];

    // Create a header row with numbers for each column
    const numColumns = Math.max(...this.rows.map(r => r.length));
    const headers = [...Array(numColumns+1).keys()].join(',').replace('0', '');
    data.push(headers + ',Average');

    this.rows.forEach((row, i) => {
      const values = row.map(e => e[dataName]);
      const avgValue = average(values).toFixed(2);

      data.push([i, ...values.map(p => p.toFixed(2)), avgValue].join(','));
    });

    setCsvLink(downloadLinkId, `${dataName}s.csv`, data);
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
  labelBlobBorders() {
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

  // Group the leaf disks into sorted rows
  setLeafDiskRows() {
    this.rows = [];

    for (const blob of this.leafDiskBlobs) {
      let blobRowAssigned = false;

      this.rows.forEach((row, i) => {
        const blobVerticalMiddle = blob.centerCoordinates().centerRow;

        if (!blobRowAssigned && row[0].top < blobVerticalMiddle && row[0].bottom > blobVerticalMiddle) {
          blobRowAssigned = true;
          blob.rowGroup = i;
          row.push(blob);
        }
      });

      // Create a new row if it didn't match any existing ones
      if (!blobRowAssigned) {
        blob.rowGroup = this.rows.length;
        this.rows.push([blob]);
      }
    }

    // Ensure blobs within each row are sorted
    for (const row of this.rows) {
      row.sort((a, b) => a.left - b.left);
    }

    // Label the row marker pixels for use in the highlighted image
    this.labelRowGroups();
  }

  // Add corner markers to each blob to indicate which row it got grouped into
  labelRowGroups() {
    for (const blob of this.leafDiskBlobs) {
      this.labelRowMarkerBlocks(blob, blob.rowGroup + 1);
    }
  }

  // Draw the corner blocks for a single blob
  labelRowMarkerBlocks(blob, number) {
    const blockSize = Math.round((blob.bottom-blob.top)/10);

    // Top left (1s)
    if (number%2 == 1) {
      this.labelRowMarkerPixels(blob.top, blob.left, blockSize);
    }
    // Top right (2s)
    if (Math.floor(number/2)%2) {
      this.labelRowMarkerPixels(blob.top, blob.right-blockSize, blockSize);
    }
    // Bottom left (4s)
    if (Math.floor(number/4)%2) {
      this.labelRowMarkerPixels(blob.bottom-blockSize, blob.left, blockSize);
    }
    // Bottom right (8s)
    if (Math.floor(number/8)%2) {
      this.labelRowMarkerPixels(blob.bottom-blockSize, blob.right-blockSize, blockSize);
    }
  }

  // Set row marker pixels starting at the given coordinates
  labelRowMarkerPixels(startRow, startCol, size) {
    const endRow = startRow + size;
    const endCol = startCol + size;

    forEachIJ(startRow, endRow, startCol, endCol, (row, col) => {
      this.pixels[row][col].isRowMarker = true;
    });
  }

  setAvgRadius() {
    const radii = this.leafDiskBlobs.map(blob => blob.radius());
    this.avgRadius = average(radii);
  }

  // Calculate the score for each leaf disk (for the single solution test)
  calculateDiskScore(blob) {
    const radius = Math.round(blob.radius()*1.1);
    const {centerRow, centerCol} = blob.centerCoordinates();
    const pixelCounts = new Array(radius);
    const rgDiffSums = new Array(radius);
    const necroticValueSums = new Array(radius);

    // Sum up the red green differences for each pixel in the leaf disk
    for (const {row, col} of blob.coordinates) {
      // The distance from the center of the disk
      const roundedDistance = Math.round(distance(row, col, centerRow, centerCol));

      if (roundedDistance >= 0 && roundedDistance < radius) {
        // Initialize if no pixels have been counted at this distance yet
        if (pixelCounts[roundedDistance] === undefined) {
          pixelCounts[roundedDistance] = 0;
          rgDiffSums[roundedDistance] = 0;
          necroticValueSums[roundedDistance] = 0;
        }

        // Increment the counts
        pixelCounts[roundedDistance]++;
        rgDiffSums[roundedDistance] += this.pixels[row][col].r - this.pixels[row][col].g;
        necroticValueSums[roundedDistance] += this.pixels[row][col].r + this.pixels[row][col].b - this.pixels[row][col].g;
      }
    }

    // The minimum sum is the extent of necrotic damage
    // Because green > red in live tissue and the center has fewer pixels, the sum increases towards the center
    // This wouldn't work if the live tissue is heavily pigmented and has red > green
    const minSum = Math.min(...rgDiffSums.filter(s => isRealNumber(s)));
    const necroticExtentI = rgDiffSums.findIndex(s => s === minSum);

    // Calculate the averages
    let necroticValueAvgs = necroticValueSums.map((s, i) => s/pixelCounts[i]);
    const minAvg = necroticValueAvgs[necroticExtentI];
    necroticValueAvgs = necroticValueAvgs.map(s => s - minAvg);

    // Sum up the averages to get the score
    blob.avgNecroticValueSum = sum(necroticValueAvgs.slice(necroticExtentI));
  }

  calculatePairSlopeScores() {
    if (this.rows.length%2 !== 0) {
      console.log('Wrong number of rows, not calculating slope score.');
      return;
    }

    const logConcentrations = [Math.log10(8), Math.log10(16)];
    const pairScores = [',Leaf 1,Leaf 2,Leaf 3,Average'];

    for (let i = 0; i < this.rows.length; i += 2) {
      const avgNecroticValueSums1 = this.rows[i].map(blob => blob.avgNecroticValueSum);
      const avgNecroticValueSums2 = this.rows[i+1].map(blob => blob.avgNecroticValueSum);
      let rowPairScores = [];

      avgNecroticValueSums1.forEach((rate, j) => {
        const point1 = {x: logConcentrations[0], y: rate};
        const point2 = {x: logConcentrations[1], y: avgNecroticValueSums2[j]};

        // Add the score for each disk pair to the csv
        rowPairScores.push(linearRegression([point1, point2]).slope);
      });

      // Add the average score to the csv
      rowPairScores.push(average(rowPairScores));
      // Round scores
      rowPairScores = rowPairScores.map(s => s.toFixed(3));
      // Add tree number column
      rowPairScores.unshift(`Tree ${i/2}`);

      pairScores.push(rowPairScores.join(','));
    }

    setCsvLink('pairScoresCsv', 'pairScores.csv', pairScores);
  }

  // Returns the slope score for the card
  calculateSlopeScore() {
    if (this.rows.length !== 4) {
      console.log('Wrong number of rows, not calculating slope score.');
      return;
    }

    const logConcentrations = [Math.log10(8), Math.log10(12), Math.log10(14), Math.log10(16)];
    const avgNecroticValueSumData = [];

    this.rows.forEach((row, i) => {
      // x: log concentration
      // y: the average value for that concentration
      avgNecroticValueSumData.push({x: logConcentrations[i], y: average(row.map(blob => blob.avgNecroticValueSum))});
    });

    return linearRegression(avgNecroticValueSumData);
  }
}


/* ============================================== */
// A class to handle pixel blob functions
/* ============================================== */
class PixelBlob {
  // Initialize with a single pixel
  // Initialize borders to +/- Infinity so that they will be overwritten when a pixel is added
  constructor() {
    this.top = Infinity;
    this.bottom = -Infinity;
    this.left = Infinity;
    this.right = -Infinity;
    this.coordinates = [];
    this.necroticCoordinates = [];
    this.liveCoordinates = [];
  }

  // Returns true if the coordinates are contained by or adjacent to the blob
  touches(row, col) {
    const rowTouches = (this.top - 1) <= row && row <= (this.bottom + 1);
    const colTouches = (this.left - 1) <= col && col <= (this.right + 1);

    return rowTouches && colTouches;
  }

  // Adjust the boundaries if necessary and add the coordinates to the array
  addPixel(row, col, isNecrotic) {
    // Update the boundaries if necessary
    if (this.top > row) this.top = row;
    if (this.bottom < row) this.bottom = row;
    if (this.left > col) this.left = col;
    if (this.right < col) this.right = col;

    // Add the pixel to the coordinates arrays
    this.coordinates.push({row: row, col: col});

    if (isNecrotic) {
      this.necroticCoordinates.push({row: row, col: col});
    } else {
      this.liveCoordinates.push({row: row, col: col});
    }
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
    this.necroticCoordinates = this.necroticCoordinates.concat(blob.necroticCoordinates);
    this.liveCoordinates = this.liveCoordinates.concat(blob.liveCoordinates);
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

  // Returns the center coordinates of the blob
  centerCoordinates() {
    return {centerRow: (this.bottom + this.top)/2, centerCol: (this.right + this.left)/2};
  }

  // Returns true if the blob's height and width are roughly equal,
  // if it has roughly the number of dark pixels expected if it were circular,
  // and if the radius is greater than 25 (no image should be less than 80 dpi)
  isLeafDisk() {
    const isSquare = isWithinTolerance(this.height(), this.width(), 0.1);
    const expectedPixels = Math.PI*(this.radius()**2);
    const isCorrectNumberOfPixels = isWithinTolerance(expectedPixels, this.coordinates.length, 0.1);

    return isSquare && isCorrectNumberOfPixels && this.radius() > 50;
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

/* ============================================== */
// Calculations
/* ============================================== */

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
  return sum(array)/array.length;
}

// Sum up all the values in the array, ignoring non-numbers
function sum(array) {
  return array.reduce((sum, value) => isRealNumber(value) ? sum + value : sum, 0)
}

// Checks if a number is a real number
function isRealNumber(num) {
  return typeof num === 'number' && !isNaN(num)
}

// Calculate linear regression https://codeforgeek.com/linear-regression-in-javascript/
// x is the index, and y is the value of the data at the index
function linearRegression(data) {
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
function rSquared(data, coefficients) {
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


/* ============================================== */
// HTML functions
/* ============================================== */

// Set the text of an element
function setText(id, text) {
  document.getElementById(id).textContent = text;
}

// Create a csv and make it the href for the download button identified by id
function setCsvLink(id, fileName, data) {
  const file = new Blob([data.join('\n')], {type: 'text/csv'});
  const a = document.getElementById(id);
  a.href = URL.createObjectURL(file);
  a.download = fileName;
}
