/*
  Process:
  1. Upload image
  2. Create pixel 2D array
  3. Label pixels isDark (all colors < 150)
    a. Create blobs
      * top
      * left
      * right
      * bottom
  4. Label blobs isLeafDisk
    * height ~= width
    * Number of pixels ~= number of pixels in a circle
  5. Find the transition point between healthy and necrotic leaf color
    a. Make a list of all dark pixels
    b. Do derivatives to isolate the transition point
  6. Label necrotic pixels in leaf disk blobs (all pixels brighter than the transition point)
    * Ignore/remove veins and isolated interior necrotic areas?
  7. Display highlighted/labeled image
    * Have a slider on the image to show before/after for visual confirmation?
  8. Sort leaf disk blobs into rows (all leaf blobs that overlap vertically are one row)
  9. Create an oxalic acid concentration (mM) input for each row
  10. Fill in concentrations
  11. Click "Process"
  12. Calculate linear regression of each row
    a. Necrotic percentage (maybe also distance from edge)
    b. Necrotic rate (% necrosis * 197.93mm^2 / hours in bath)
      * 197.93mm^2 = area of leaf disk
    c. Calculate linear regression of necrotic rate (y) versus log(concentration) (x)
  13. Display results

  Future:
  * Add R^2 value for linear regression
  * Speed up processing time
  * Show graph of concentration/necrotic
*/

window.onload = function() {
  document.querySelector('input#imageUpload').onchange = loadImage;
}

function loadImage() {
  const file = document.querySelector('input#imageUpload').files[0];

  getFileContentsAsBase64(file, (base64) => {
    document.querySelector('img#originalImage').src = base64;

    base64ToPixels(base64, (pixels) => {
      // Find the darker areas (leaf disks and writing)
      ({blobs, pixels} = findDarkBlobs(pixels));

      // Label each blob if it is a leaf disk or not
      blobs.forEach((blob) => blob.isLeafDisk = isBlobCircular(blob));
      let leafDiskBlobs = blobs.filter((blob) => blob.isLeafDisk).sort((a, b) => a.left - b.left);

      // Group blobs into rows and sort
      let rows = groupBlobsByRow(leafDiskBlobs).sort((a, b) => a[0].top - b[0].top);

      // Classify which pixels are necrotic
      ({rows, pixels} = setNecroticPixels(rows, pixels));

      // Set necroticPortion and necroticRate for each blob
      leafDiskBlobs.forEach((blob) => blob.necroticPortion = blob.necroticCoordinates.length/blob.pixelCoordinates.length);

      // Create and append concentration inputs
      const defaultConcentrations = [8, 12, 14, 16];
      rows.forEach((row, i) => createConcentrationInput(i, row[0].top, defaultConcentrations[i]));

      // Create borders to show user
      pixels = drawBlobBorders(leafDiskBlobs, pixels);

      // Do linear regression and display it on screen
      doCalculations(rows);

      document.querySelector('img#highlightedImage').src = pixelsToBase64(pixels);

      // Enable "Recalculate" button
      const button = document.getElementById('calculate');
      button.onclick = () => doCalculations(rows);
    });
  });
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
    // I iniially tried using `.fill([])`, but that seemed to make all the rows the same array object
    let pixels = Array(imageData.height);

    for (let row = 0; row < imageData.height; row++) {
      pixels[row] = [];

      for (let col = 0; col < imageData.width; col++) {
        const pixelNum = row*imageData.width + col;
        const data = imageData.data.slice(pixelNum*4, pixelNum*4 + 3);

        pixels[row][col] = {r: data[0], g: data[1], b: data[2]};
      }
    }

    callback(pixels);
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
function findDarkBlobs(pixels) {
  let blobs = [];
  const height = pixels.length;
  const width = pixels[0].length;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      // Start new blob if the pixel has not already been added to a blob and is dark
      if (!pixels[row][col].isDark && isDark(pixels[row][col])) {
        // Create new blob
        let newBlob = {pixelCoordinates: [], top: row, left: col, right: col, bottom: row};
        ({blob, pixels} = markBlobDarkPixels(newBlob, pixels, col, row));

        // Add blob to the list
        blobs.push(blob);
      }
    }
  }

  return {blobs: consolidateBlobs(blobs), pixels: pixels};
}

// Determine if a pixel is dark
function isDark(pixel) {
  return pixel.r < 150 && pixel.g < 150 && pixel.b < 150;
}

// Mark all the dark pixels in a blob starting at x, y
function markBlobDarkPixels(blob, pixels, x, y) {
  const height = pixels.length;
  const width = pixels[0].length;
  let currentPixel = {x: x, y: y};

  for (let row = y; row < height; row++) {
    // Check pixels to the right
    for (let col = x; col < width; col++) {
      if (!pixels[row][col].isDark && isDark(pixels[row][col])) {
        currentPixel = {x: col, y: row};
        ({blob, pixels} = markDarkPixel(blob, pixels, currentPixel));
      } else {
        // Update right border
        blob.right = Math.max(blob.right, currentPixel.x);
        break;
      }
    }
    // Check pixels to the left
    for (let col = x-1; col >= 0; col--) {
      if (!pixels[row][col].isDark && isDark(pixels[row][col])) {
        currentPixel = {x: col, y: row};
        ({blob, pixels} = markDarkPixel(blob, pixels, currentPixel));
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
  // Return blob and updated labeled pixels
  return {blob: blob, pixels: pixels};
}

function markDarkPixel(blob, pixels, pixel) {
  // Add new pixel to the list
  blob.pixelCoordinates.push(pixel);

  // Mark pixel as dark
  pixels[pixel.y][pixel.x].isDark = true;

  return {blob: blob, pixels: pixels};
}

// Consolidate blobs if they touch or overlap
function consolidateBlobs(blobs) {
  const consolidatedBlobsList = [];

  for (const blob of blobs) {
    let blobMerged = false;

    consolidatedBlobsList.forEach((existingBlob) => {
      if (!blobMerged && doBlobsTouch(existingBlob, blob)) {
        blobMerged = true;
        existingBlob = mergeBlobs(existingBlob, blob);
      }
    });

    // Add to consolidatedBlobsList if not merged
    if (!blobMerged) {
      consolidatedBlobsList.push(blob);
    }
  }

  return consolidatedBlobsList;
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

  return blob1;
}

// Add the blob borders to the image
function drawBlobBorders(blobs, pixels) {
  blobs.forEach((blob) => {
    const color = blob.isLeafDisk ? {r: 0, g: 200, b: 0} : {r: 0, g: 0, b: 0};

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

  return pixels;
}

// Determine if a blob is a circle based on the ratio of height/width and the number of pixels
function isBlobCircular(blob) {
  const height = blob.bottom - blob.top;
  const width = blob.right - blob.left;

  // Width is within 2% of height
  const isSquare = isWithinTolerance(height, width, 0.02);

  // The number of pixels is within 2% of expected for a circle
  const numCirclePixels = Math.PI*(((height + width)/4)**2);
  const isCorrectNumberOfPixels = isWithinTolerance(numCirclePixels, blob.pixelCoordinates.length, 0.02)

  return isSquare && isCorrectNumberOfPixels;
}

// Determine if a number is within the given tolerance of another number
function isWithinTolerance(correctNum, num, tolerance) {
  return Math.abs(correctNum - num) < correctNum*tolerance
}

// Sort pixels into healthy (dark) and dead (light)
function setNecroticPixels(rows, pixels) {
  for (let rowI = 0; rowI < rows.length; rowI++) {
    for (let blobI = 0; blobI < rows[rowI].length; blobI++) {
      const blob = rows[rowI][blobI];

      // Create an array of the sums and their corresponding coordinates
      const colorSums = blob.pixelCoordinates.map((coordinate) => colorSum(coordinate, pixels));
      colorSums.sort((a, b) => a.sum - b.sum);

      // Index at the center of the transition between the healthy and necrotic color plateaus
      const transitionI = findTransitionIndex(colorSums.map((colorSum) => colorSum.sum));

      blob.necroticCoordinates = colorSums.slice(transitionI).map((colorSum) => colorSum.coordinate);

      for (const coordinate of blob.necroticCoordinates) {
        pixels[coordinate.y][coordinate.x].isNecrotic = true;
      }

      if (document.getElementById('showBrightnessGraphs').checked) {
        // Plot color sums for visual confirmation
        plotColorSums(colorSums, transitionI, rowI, blobI);
      }
    }
  }

  return {rows: rows, pixels: pixels};
}

// Sum up the rgb values of the pixel to be used as a brightness value
function colorSum(coordinate, pixels) {
  const pixel = pixels[coordinate.y][coordinate.x];

  return {
    sum: pixel.r + pixel.g + pixel.b,
    coordinate: coordinate
  };
}

function slope(x1, y1, x2, y2) {
  return (y1 - y2)/(x1 - x2);
}

// Find where the data transitions between the two plateaus
// The two plateaus are the healthy (dark) and dead (light) colors
function findTransitionIndex(data) {
  // Average over 10% to smooth out data
  // Spike in slopes corresponds to the transition (slope increases then decreases)
  const slopes = smoothedDerivative(data, 0.05, data.length/500);
  const peakI = findPeak(slopes);

  return Math.round(scaleArrayIndex(peakI, data.length, 0.05, data.length/500));
}

// Find the peak of the data (spike in the middle of the graph, not the maximum value)
function findPeak(data) {
  // The peak is where the slope goes from positive to negative (x intercept)
  const slopes = smoothedDerivative(data, 0.05);

  // The local maximum is now the minimum of all the data
  const slopeDerivative = smoothedDerivative(slopes, 0.01);

  // Position of minimum
  const minI = slopeDerivative.indexOf(Math.min(...slopeDerivative));

  // x intercept of `slopes`
  const xInterceptI = scaleArrayIndex(minI, slopes.length, 0.01);

  return scaleArrayIndex(xInterceptI, data.length, 0.05);
}

// Scale an index from the smoothedDerivative array to the corresponding index in the original array
function scaleArrayIndex(i, originalLength, smoothingFactor, step=1) {
  const chunkSize = chunkLength(originalLength, smoothingFactor);

  return i*step + (chunkSize - 1)/2;
}

// Calculate the derivative using chunks of `smoothingFactor` to smooth it out
function smoothedDerivative(data, smoothingFactor, step=1) {
  const slopes = [];
  const chunkSize = chunkLength(data.length, smoothingFactor);
  const end = data.length*(1 - smoothingFactor);

  for (let i = 0; i <= end; i += step) {
    const chunk = data.slice(i, i + chunkSize);
    slopes.push(linearRegression(chunk.map((num, i) => ({x: i, y: num}))).slope);
  }

  return slopes;
}

function chunkLength(dataLength, smoothingFactor) {
  // Needs to be at least 2 to calculate linear regression
  return Math.max(Math.round(dataLength*smoothingFactor), 2);
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

function groupBlobsByRow(blobs) {
  const rows = [];

  for (const blob of blobs) {
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

  return rows;
}

// Create inputs for the oxalic acid concentrations of each row
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
function doCalculations(rows) {
  const regression = calculateSusceptibility(rows);

  document.getElementById('slope').textContent = regression.slope;
  document.getElementById('yIntercept').textContent = regression.yIntercept;
  document.getElementById('rSquared').textContent = regression.rSquared;
}

// Calculate the susceptibility linear regression
function calculateSusceptibility(rows) {
  const concentrationInputs = document.querySelectorAll('input.concentration');
  const data = [];

  const radius = parseFloat(document.getElementById('diskDiameter').value)/2;
  const area = Math.PI*(radius**2);
  const hours = parseFloat(document.getElementById('hoursSoaked').value);

  for (let rowI = 0; rowI < rows.length; rowI++) {
    for (let blobI = 0; blobI < rows[rowI].length; blobI++) {
      rows[rowI][blobI].necroticRate = rows[rowI][blobI].necroticPortion*area/hours;
    }
  }

  concentrationInputs.forEach((input) => {
    const row = rows[input.row];
    const necroticRateAvg = row.reduce((total, blob) => total + blob.necroticRate, 0)/row.length;
    data[input.row] = {x: Math.log10(input.value), y: necroticRateAvg};
  });

  xValues = data.map((point) => point.x);
  yValues = data.map((point) => point.y);
  xMin = Math.min(...xValues);
  xMax = Math.max(...xValues);
  yMin = Math.min(...yValues);
  yMax = Math.max(...yValues);

  plot(document.getElementById('susceptibilityGraph'), data, xMin*0.9, xMax*1.1, yMin*0.9, yMax*1.1, true);

  return linearRegression(data);
}

function plotColorSums(colorSums, transitionI, row, col) {
  // Limit to about 500 elements and map to x, y coordinates
  const step = Math.round(colorSums.length/500);
  const data = colorSums.filter((sum, i) => i%step == 0).map((sum, i) => ({x: i, y: sum.sum}));

  // Create the graph element
  const graph = document.createElement('div');
  graph.style.position = 'relative';
  graph.style.display = 'inline-block';
  graph.style.height = '300px';
  graph.style.width = `calc(33% - 40px)`;
  graph.style.margin = '20px';

  // Add a line to show the transition cutoff
  const labelAreaSize = 30;
  const graphYPixels = 300 - labelAreaSize;
  const yPixels = graphYPixels*colorSums[transitionI].sum/475;

  const line = document.createElement('div');
  line.style.position = 'absolute';
  line.style.left = `${labelAreaSize}px`;
  line.style.bottom = `calc(${yPixels}px + ${labelAreaSize}px)`;
  line.style.width = `calc(100% - ${labelAreaSize}px)`;
  line.style.border = '1px solid';
  graph.append(line);

  // Label which leaf disk it is
  const label = document.createElement('span');
  label.textContent = `row: ${row + 1}, col: ${col + 1}`;
  label.style.position = 'absolute';
  label.style.top = 0;
  label.style.left = `${labelAreaSize + 20}px`;
  graph.append(label);

  // Append before plotting the element knows what size it is
  document.getElementById('brightnessGraphs').append(graph)

  plot(graph, data, 0, 550, 0, 475);

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
