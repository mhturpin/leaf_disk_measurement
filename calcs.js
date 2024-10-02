/*
  Process:
  1. User uploads image
  2. Create pixel 2D array
  3. Label pixels isDark (all colors < 200)
    a. Create blobs
      * top
      * left
      * right
      * bottom
    b. Merge any blobs that are touching
  4. Label blobs isLeafDisk
    * height ~= width
    * Number of pixels ~= number of pixels in a circle
    * height > 100 pixels
  5. Group leaf disks into rows
  6. Label necrotic pixels (pixels where there is more red than green)
  7. Add inputs in line with rows to allow adjusting the concentrations if needed
  8. Draw borders around the leaf disks
  9. Calculate the linear regression for both area and width and display values and graph on screen
  10. Display highlighted image
  11. Add a button to allow recalculating after changing inputs
*/

var pixels = [];
var blobs = [];
var leafDiskBlobs = [];
var rows = [];

window.onload = function() {
  document.querySelector('input#imageUpload').onchange = processImage;
}

function processImage() {
  // Clear out existing data from any previous image
  clearExistingData();

  // Display original image
  const file = document.querySelector('input#imageUpload').files[0];

  getFileContentsAsBase64(file, (base64) => {
    document.querySelector('img#originalImage').src = base64;

    // Set pixels, then do processing in callback
    base64ToPixels(base64, () => {
      findDarkBlobs();
      findLeafDisks();
      groupBlobsByRow();
      setNecroticPixels();
      createConcentrationInputs();
      drawLeafDiskBorders();
      doCalculations();

      // Display processed image
      document.querySelector('img#highlightedImage').src = pixelsToBase64(pixels);

      // Enable "Recalculate" button
      const button = document.getElementById('calculate');
      button.onclick = () => doCalculations();
    });
  });
}

function clearExistingData() {
  pixels = [];
  blobs = [];
  leafDiskBlobs = [];
  rows = [];

  document.getElementById('concentrationInputs').innerHTML = '';
  document.getElementById('susceptibilityGraphArea').innerHTML = '';
  document.getElementById('susceptibilityGraphWidth').innerHTML = '';

  document.querySelector('#linearRegressionArea .slope').textContent = '';
  document.querySelector('#linearRegressionArea .yIntercept').textContent = '';
  document.querySelector('#linearRegressionArea .rSquared').textContent = '';

  document.querySelector('#linearRegressionWidth .slope').textContent = '';
  document.querySelector('#linearRegressionWidth .yIntercept').textContent = '';
  document.querySelector('#linearRegressionWidth .rSquared').textContent = '';

}

// Convert file to base64
function getFileContentsAsBase64(file, callback) {
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => callback(e.target.result);
    reader.readAsDataURL(file);
  }
}

// Convert a base64 encoded image into an 2D array of pixels
function base64ToPixels(base64, callback) {
  // Create temporary image
  const img = document.createElement('img');

  // Set a callback on image load to convert image to pixels
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.height = img.height;
    canvas.width = img.width;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    // imageData.data is a flattened array of all the pixel values
    // 4 values represents 1 pixel (r, g, b, a)
    let imageData = ctx.getImageData(0, 0, img.width, img.height);
    // Initialize pixels based on height and width
    // I iniially tried using `.fill([])`, but that made all the rows the same array object
    pixels = Array(imageData.height);

    for (let row = 0; row < imageData.height; row++) {
      pixels[row] = [];

      for (let col = 0; col < imageData.width; col++) {
        const pixelNum = row*imageData.width + col;
        const data = imageData.data.slice(pixelNum*4, pixelNum*4 + 3);

        pixels[row][col] = {r: data[0], g: data[1], b: data[2]};
      }
    }

    callback();
  };

  // Load the image and trigger the onload function
  img.src = base64;
}

// Convert the pixel 2D array back to base64
function pixelsToBase64(pixels) {
  const height = pixels.length;
  const width = pixels[0].length;
  const imageData = new ImageData(width, height);

  // Populate imageData with pixel values
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const pixelNum = row*width + col;

      imageData.data[pixelNum*4] = pixels[row][col].r;
      imageData.data[pixelNum*4 + 1] = pixels[row][col].g;
      imageData.data[pixelNum*4 + 2] = pixels[row][col].b;
      imageData.data[pixelNum*4 + 3] = 255; // Alpha

      if (pixels[row][col].isNecrotic) {
        imageData.data[pixelNum*4] = 255;
        imageData.data[pixelNum*4 + 1] = 100;
        imageData.data[pixelNum*4 + 2] = 0;
        imageData.data[pixelNum*4 + 3] = 255; // Alpha
      } else if (pixels[row][col].isDark) {
        imageData.data[pixelNum*4] = 0;
        imageData.data[pixelNum*4 + 1] = 200;
        imageData.data[pixelNum*4 + 2] = 0;
        imageData.data[pixelNum*4 + 3] = 255; // Alpha
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.height = imageData.height;
  canvas.width = imageData.width;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL();
}

// Create a list of all the connected areas of dark pixels
function findDarkBlobs() {
  const height = pixels.length;
  const width = pixels[0].length;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      // Start new blob if the pixel has not already been added to a blob and is dark
      if (!pixels[row][col].isDark && isDark(col, row)) {
        // Create new blob
        let newBlob = {pixelCoordinates: [], top: row, left: col, right: col, bottom: row};
        markBlobDarkPixels(newBlob, col, row);

        // Add blob to the list
        blobs.push(newBlob);
      }
    }
  }

  consolidateBlobs();
}

// Determine if a pixel is dark
function isDark(x, y) {
  let pixel = pixels[y][x];
  return pixel.r < 200 && pixel.g < 200 && pixel.b < 200;
}

// Mark all the dark pixels in a blob starting at x, y
function markBlobDarkPixels(blob, x, y) {
  const height = pixels.length;
  const width = pixels[0].length;
  let currentPixel = {x: x, y: y};

  for (let row = y; row < height; row++) {
    // Check pixels to the right
    for (let col = x; col < width; col++) {
      if (!pixels[row][col].isDark && isDark(col, row)) {
        currentPixel = {x: col, y: row};
        markDarkPixel(blob, currentPixel);
      } else {
        // Update right border
        blob.right = Math.max(blob.right, currentPixel.x);
        break;
      }
    }
    // Check pixels to the left
    for (let col = x-1; col >= 0; col--) {
      if (!pixels[row][col].isDark && isDark(col, row)) {
        currentPixel = {x: col, y: row};
        markDarkPixel(blob, currentPixel);
      } else {
        // Update left border
        blob.left = Math.min(blob.left, currentPixel.x);
        break;
      }
    }

    // If the current row didn't have any dark pixels, the blob is done
    if (currentPixel.y < row) {
      break;
    }
  }

  // Update bottom border
  blob.bottom = currentPixel.y;
}

function markDarkPixel(blob, pixel) {
  // Add new pixel to the list
  blob.pixelCoordinates.push(pixel);

  // Mark pixel as dark
  pixels[pixel.y][pixel.x].isDark = true;
}

// Consolidate blobs if they touch or overlap
function consolidateBlobs() {
  const consolidatedBlobsList = [];

  for (const blob of blobs) {
    let blobMerged = false;

    // Check if the blob overlaps one already in the list
    consolidatedBlobsList.forEach((existingBlob) => {
      if (!blobMerged && doBlobsTouch(existingBlob, blob)) {
        blobMerged = true;
        // Merge blob into existingBlob
        mergeBlobs(existingBlob, blob);
      }
    });

    // Add to consolidatedBlobsList if not merged
    if (!blobMerged) {
      consolidatedBlobsList.push(blob);
    }
  }

  blobs = consolidatedBlobsList;
}

// Determine if the two blobs touch or overlap
function doBlobsTouch(blob1, blob2) {
  // Add/subtract 1 to include if they are adjacent
  const verticalOverlap = rangesOverlap(blob1.top-1, blob1.bottom+1, blob2.top, blob2.bottom);
  const horizontalOverlap = rangesOverlap(blob1.left-1, blob1.right+1, blob2.left, blob2.right);

  return verticalOverlap && horizontalOverlap;
}

// Check if the two ranges overlap
function rangesOverlap(start1, end1, start2, end2) {
  return start1 <= end2 && start2 <= end1;
}

// Merge the two blobs
function mergeBlobs(blob1, blob2) {
  blob1.top = Math.min(blob1.top, blob2.top);
  blob1.bottom = Math.max(blob1.bottom, blob2.bottom);
  blob1.left = Math.min(blob1.left, blob2.left);
  blob1.right = Math.max(blob1.right, blob2.right);
  blob1.pixelCoordinates = blob1.pixelCoordinates.concat(blob2.pixelCoordinates);
}

function findLeafDisks() {
  // Label each blob if it is a leaf disk or not
  blobs.forEach((blob) => blob.isLeafDisk = isBlobCircular(blob));

  // Pull out all the leaf disk blobs and sort by left index
  leafDiskBlobs = blobs.filter((blob) => blob.isLeafDisk).sort((a, b) => a.left - b.left);
}

// Add the blob borders to the image
function drawLeafDiskBorders() {
  leafDiskBlobs.forEach((blob) => {
    const color = {r: 0, g: 0, b: 0};

    // Draw vertical lines
    for (let row = blob.top-1; row <= blob.bottom+1; row++) {
      pixels[row][blob.left-1] = color;
      pixels[row][blob.right+1] = color;
      pixels[row][blob.left-2] = color;
      pixels[row][blob.right+2] = color;
    }

    // Draw horizontal lines
    for (let col = blob.left-1; col <= blob.right+1; col++) {
      pixels[blob.top-1][col] = color;
      pixels[blob.bottom+1][col] = color;
      pixels[blob.top-2][col] = color;
      pixels[blob.bottom+2][col] = color;
    }
  });
}

// Determine if a blob is a circle based on the ratio of height/width and the number of pixels
function isBlobCircular(blob) {
  const height = blob.bottom - blob.top;
  const width = blob.right - blob.left;

  // Width is within 2% of height
  const isSquare = isWithinTolerance(height, width, 0.06);

  // The number of pixels is within 2% of expected for a circle
  const numCirclePixels = Math.PI*(((height + width)/4)**2);
  const isCorrectNumberOfPixels = isWithinTolerance(numCirclePixels, blob.pixelCoordinates.length, 0.05)

  return isSquare && isCorrectNumberOfPixels && height > 100;
}

// Determine if a number is within the given tolerance of another number
function isWithinTolerance(correctNum, num, tolerance) {
  return Math.abs(correctNum - num) < correctNum*tolerance
}

// Sort pixels into healthy (dark) and dead (light)
function setNecroticPixels() {
  for (let rowI = 0; rowI < rows.length; rowI++) {
    for (let blobI = 0; blobI < rows[rowI].length; blobI++) {
      const blob = rows[rowI][blobI];

      // It's necrotic if there's more red than green
      blob.necroticCoordinates = blob.pixelCoordinates.filter((c) => pixels[c.y][c.x].r > pixels[c.y][c.x].g);

      // Set necrotic pixels
      for (const coordinate of blob.necroticCoordinates) {
        pixels[coordinate.y][coordinate.x].isNecrotic = true;
      }

      // Unset necrotic pixels that are veins
      // Do it a few times because removing some pixels might mean more are caught the next time
      for (let j = 0; j < 5; j++) {
        blob.necroticCoordinates.forEach((coordinate, i) => {
          if (isVein(coordinate.x, coordinate.y)) {
            // Remove from blob
            blob.necroticCoordinates.splice(i, 1);
            // Remove from pixels
            pixels[coordinate.y][coordinate.x].isNecrotic = false;
          }
        });
      }
    }
  }

  leafDiskBlobs.forEach((blob) => blob.necroticPortion = blob.necroticCoordinates.length/blob.pixelCoordinates.length);
}

// Calculate linear regression https://codeforgeek.com/linear-regression-in-javascript/
// x is the index, and y is the value of the data at the index
function linearRegression(data) {
  let xsum = 0;
  let ysum = 0;

  for (const point of data) {
    xsum += point.x;
    ysum += point.y;
  }

  const xmean = xsum / data.length;
  const ymean = ysum / data.length;

  let num = 0;
  let denom = 0;

  for (const point of data) {
    const x = point.x;
    const y = point.y;
    num += (x - xmean) * (y - ymean);
    denom += (x - xmean) * (x - xmean);
  }

  const m = num / denom
  const b = ymean - (m * xmean);
  const coefficients = {slope: m, yIntercept: b};

  return {...coefficients, rSquared: rSquared(data, coefficients)};
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

// Group the blobs by row and sort
function groupBlobsByRow() {
  rows = [];

  for (const blob of leafDiskBlobs) {
    let blobRowAssigned = false;

    rows.forEach((row) => {
      if (!blobRowAssigned && rangesOverlap(row[0].top, row[0].bottom, blob.top, blob.bottom)) {
        blobRowAssigned = true;
        row.push(blob);
      }
    });

    // Create a new row if it didn't match any existing ones
    if (!blobRowAssigned) {
      rows.push([blob]);
    }
  }

  rows.sort((a, b) => a[0].top - b[0].top);
}

// Create inputs for the oxalic acid concentrations of each row
function createConcentrationInputs() {
  const defaultConcentrations = [8, 12, 14, 16];
  rows.forEach((row, i) => createConcentrationInput(i, row[0].top, defaultConcentrations[i]));
}

function createConcentrationInput(rowI, rowY, concentration) {
  const originalImg = document.getElementById('originalImage');

  // Use the ratio of the displayed image to the original height to calculate the offset needed for the input
  const ratioY = originalImg.offsetHeight/originalImg.naturalHeight;
  const rowOffsetTop = ratioY*rowY + originalImg.offsetTop;

  // Create input
  const input = document.createElement('input');
  input.type = 'number';
  input.classList.add('concentration');
  input.row = rowI;
  input.value = concentration;
  input.style.position = 'absolute';
  input.style.left = '10px';
  input.style.top = `${rowOffsetTop}px`;

  // Append input
  document.getElementById('concentrationInputs').append(input);
}

// Do the calculations and display the results on screen
function doCalculations() {
  const regression = calculateSusceptibility();

  // Display regression values for area calculation
  document.querySelector('#linearRegressionArea .slope').textContent = regression.area.slope;
  document.querySelector('#linearRegressionArea .yIntercept').textContent = regression.area.yIntercept;
  document.querySelector('#linearRegressionArea .rSquared').textContent = regression.area.rSquared;

  // Display regression values for width calculation
  document.querySelector('#linearRegressionWidth .slope').textContent = regression.width.slope;
  document.querySelector('#linearRegressionWidth .yIntercept').textContent = regression.width.yIntercept;
  document.querySelector('#linearRegressionWidth .rSquared').textContent = regression.width.rSquared;
}

// Calculate the susceptibility linear regression
function calculateSusceptibility() {
  const concentrationInputs = document.querySelectorAll('input.concentration');
  const dataArea = [];
  const dataWidth = [];

  const radius = parseFloat(document.getElementById('diskDiameter').value)/2;
  const diskArea = Math.PI*(radius**2);
  const hours = parseFloat(document.getElementById('hoursSoaked').value);

  for (let rowI = 0; rowI < rows.length; rowI++) {
    for (let blobI = 0; blobI < rows[rowI].length; blobI++) {
      const necroticArea = rows[rowI][blobI].necroticPortion*diskArea;

      rows[rowI][blobI].necroticRateArea = necroticArea/hours;
      rows[rowI][blobI].necroticRateWidth = calculateRingWidth(radius, necroticArea)/hours;
    }
  }

  concentrationInputs.forEach((input) => {
    const row = rows[input.row];
    const necroticRateAreaAvg = row.reduce((total, blob) => total + blob.necroticRateArea, 0)/row.length;
    const necroticRateWidthAvg = row.reduce((total, blob) => total + blob.necroticRateWidth, 0)/row.length;

    dataArea[input.row] = {x: Math.log10(input.value), y: necroticRateAreaAvg};
    dataWidth[input.row] = {x: Math.log10(input.value), y: necroticRateWidthAvg};
  });

  // Plot for calculation using area
  let xValues = dataArea.map((point) => point.x);
  let yValues = dataArea.map((point) => point.y);
  let xMin = Math.min(...xValues);
  let xMax = Math.max(...xValues);
  let yMin = Math.min(...yValues);
  let yMax = Math.max(...yValues);

  plot(document.getElementById('susceptibilityGraphArea'), dataArea, xMin*0.9, xMax*1.1, yMin*0.9, yMax*1.1, true);

  // Plot for calculation using width
  xValues = dataWidth.map((point) => point.x);
  yValues = dataWidth.map((point) => point.y);
  xMin = Math.min(...xValues);
  xMax = Math.max(...xValues);
  yMin = Math.min(...yValues);
  yMax = Math.max(...yValues);

  plot(document.getElementById('susceptibilityGraphWidth'), dataWidth, xMin*0.9, xMax*1.1, yMin*0.9, yMax*1.1, true);

  return {area: linearRegression(dataArea), width: linearRegression(dataWidth)};
}

// Calculate the width of the ring of necrotic tissue
// using the radius of the leaf and the area of the ring
function calculateRingWidth(r, area) {
  return r - Math.sqrt(r**2 - (area/Math.PI));
}

// Plot the data in the provided div
function plot(graph, data, xMin, xMax, yMin, yMax, clearChildren=false) {
  if (clearChildren) {
    // Delete all the graph's children
    graph.innerHTML = '';
  }

  drawAxes(graph, xMin, xMax, yMin, yMax);

  for (const point of data) {
    plotPoint(graph, point, xMin, xMax, yMin, yMax);
  }
}

function drawAxes(graph, xMin, xMax, yMin, yMax) {
  const labelAreaSize = 30;
  const graphXPixels = graph.offsetWidth - labelAreaSize;
  const graphYPixels = graph.offsetHeight - labelAreaSize;
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;
  const xLabelInterval = parseFloat((xRange/5).toPrecision(2));
  const yLabelInterval = parseFloat((yRange/5).toPrecision(2));

  const axes = document.createElement('div');
  axes.style.marginLeft = `${labelAreaSize}px`;
  axes.style.marginBottom = `${labelAreaSize}px`;
  axes.style.height = `calc(100% - ${labelAreaSize}px)`;
  axes.style.width = `calc(100% - ${labelAreaSize}px)`;
  axes.style.borderLeft = '2px solid';
  axes.style.borderBottom = '2px solid';
  graph.append(axes);

  // x axis labels
  for (let i = xMin; i <= xMax; i += xLabelInterval) {
    const xPixels = graphXPixels*(i - xMin)/xRange;

    const tickMark = document.createElement('div');
    tickMark.style.height = '5px';
    tickMark.style.width = '0px';
    tickMark.style.position = 'absolute';
    tickMark.style.left = `calc(${xPixels}px + ${labelAreaSize}px)`;
    tickMark.style.bottom = `${labelAreaSize - 8}px`;
    tickMark.style.border = '1px solid';
    graph.append(tickMark);

    const label = document.createElement('div');
    // Round to 2 significant figures and convert to float to avoid scientific notation
    label.textContent = parseFloat(i.toPrecision(2));
    label.style.position = 'absolute';
    label.style.left = `calc(${xPixels}px + 21px)`;
    label.style.bottom = `0px`;
    graph.append(label);
  }

  // y axis labels
  for (let i = yMin; i <= yMax; i += yLabelInterval) {
    const yPixels = graphYPixels*(i - yMin)/yRange;

    const tickMark = document.createElement('div');
    tickMark.style.height = '0px';
    tickMark.style.width = '5px';
    tickMark.style.position = 'absolute';
    tickMark.style.left = `${labelAreaSize - 7}px`;
    tickMark.style.bottom = `calc(${yPixels}px + ${labelAreaSize}px)`;
    tickMark.style.border = '1px solid';
    graph.append(tickMark);

    const label = document.createElement('div');
    label.textContent = parseFloat(i.toPrecision(2));
    label.style.position = 'absolute';
    label.style.left = `0px`;
    label.style.bottom = `calc(${yPixels}px + 21px)`;
    graph.append(label);
  }
}

function plotPoint(graph, point, xMin, xMax, yMin, yMax) {
  const labelAreaSize = 30;
  const graphXPixels = graph.offsetWidth - labelAreaSize;
  const graphYPixels = graph.offsetHeight - labelAreaSize;
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;
  const xPixels = graphXPixels*(point.x - xMin)/xRange;
  const yPixels = graphYPixels*(point.y - yMin)/yRange;

  const div = document.createElement('div');
  div.style.position = 'absolute';
  div.style.left = `calc(${xPixels}px + ${labelAreaSize}px)`;
  div.style.bottom = `calc(${yPixels}px + ${labelAreaSize}px)`;
  div.style.border = '3px solid';

  graph.append(div);
}

// Determine if a pixel is part of a vein
function isVein(x, y) {
  let neighboringNecroticPixels = 0;

  for (let row = y - 5; row <= y + 5; row++) {
    for (let col = x - 5; col <= x + 5; col++) {
      if (pixels[row][col].isNecrotic) {
        neighboringNecroticPixels++;
      }
    }
  }

  // Consider it a vein if less than 33% of the neighboring pixels are necrotic
  return neighboringNecroticPixels < 121*0.33;
}
