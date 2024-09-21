/*
  Process:
  1. Upload image
  2. Create pixel 2D array
  3. Label pixels isDark (maybe >50% r and g, >25% b)
    a. Create blobs
      * top
      * left
      * right
      * bottom
  4. Label blobs isLeafDisk
    * height ~= width
    * Number of pixels ~= pi*(height/2)^2
  5. Find the average healthy and necrotic leaf color
    a. Make a list of all dark pixels in all blobs
    b. Divide into light (necrotic) and dark (healthy)
    c. Take an average of necrotic and healthy colors
  6. Label pixels in leaf disk blobs
    * isLeaf: All pixels in necrotic-healthy range +/- some %
    * isNecrotic: necrotic color +/- some %
      * Ignore/remove veins?
      * Ignore/remove isolated interior necrotic areas
  7. Display highlighted/labeled image
    * Maybe have slider on image to show before/after for visual confirmation
  8. Sort leaf disk blobs into rows
    * top and bottom +/- some % of each other
  9. Create an oxalic acid concentration (mM) input for each row
  10. Fill in concentrations
  11. Click "Process"
  12. Calculate linear regression of each row
    a. Necrotic percentage (maybe also distance from edge)
    b. Necrotic rate (% necrosis * 197.93mm^2 / hours in bath)
      * 197.93mm^2 = area of leaf disk
    c. Calculate linear regression of necrotic rate (y) versus log(concentration) (x)
  13. Display results
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

      // Create borders to show user
      pixels = drawBlobBorders(blobs, pixels);

      // Find the average healthy and dead color
      let leafDiskBlobs = blobs.filter((blob) => blob.isLeafDisk);
      ({leafDiskBlobs, pixels} = setNecroticPixels(leafDiskBlobs, pixels));



      // Count all pixels with range of health-dead (maybe not necessary)
      // Count dead pixels
      // Percentage of dead/total pixels
      // 214 Darkest light
      // 204 Lightest dark


      document.querySelector('img#highlighted').src = pixelsToBase64(pixels);
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

      if (pixels[row][col].isDark) {
        imageData.data[pixelNum*4] = 255;
        imageData.data[pixelNum*4 + 1] = 0;
        imageData.data[pixelNum*4 + 2] = 255;
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
  let consolidatedBlobsList = [];

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
function setNecroticPixels(leafDiskBlobs, pixels) {
  leafDiskBlobs.forEach((blob) => {

    // Create an array of the sums and their corresponding coordinates
    const colorSums = blob.pixelCoordinates.map((coordinate) => colorSum(coordinate, pixels));
    colorSums.sort((a, b) => a.sum - b.sum);

    // Index at the center of the transition between the healthy and necrotic color plateaus
    const transitionI = findTransitionIndex(colorSums.map((colorSum) => colorSum.sum));

    console.log(`transitionI: ${transitionI}, sum: ${colorSums[transitionI].sum}`);
    // Set list of coordinates of necrotic
  });


  return leafDiskBlobs;
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
  const slopes = smoothedDerivative(data, 0.05);
  const peakI = findPeak(slopes);

  return Math.round(scaleArrayIndex(peakI, data.length, 0.05));
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
function scaleArrayIndex(i, originalLength, smoothingFactor) {
  const chunkSize = chunkLength(originalLength, smoothingFactor);

  return i + (chunkSize - 1)/2;
}

// Calculate the derivative using chunks of `smoothingFactor` to smooth it out
function smoothedDerivative(data, smoothingFactor) {
  const slopes = [];
  const chunkSize = chunkLength(data.length, smoothingFactor);
  const end = data.length*(1 - smoothingFactor);

  for (let i = 0; i <= end; i++) {
    const chunk = data.slice(i, i + chunkSize);
    slopes.push(linearRegression(chunk).slope);
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

  for (let i = 0; i < data.length; i ++) {
    xsum += i;
    ysum += data[i];
  }

  const xmean = xsum / data.length;
  const ymean = ysum / data.length;

  let num = 0;
  let denom = 0;

  for (let i = 0; i < data.length; i ++) {
    const x = i;
    const y = data[i];
    num += (x - xmean) * (y - ymean);
    denom += (x - xmean) * (x - xmean);
  }

  const m = num / denom
  const b = ymean - (m * xmean);

  return {slope: m, yIntercept: b};
}









// =============================================================================
// =============================================================================
// =============================================================================
// =============================================================================
// =============================================================================
// =============================================================================
// Old

var dragStart;

// window.onload =
function a() {
  let originalImage = document.querySelector('div#originalImage img');
  document.querySelector('input#imageUpload').onchange = displayImage;

  document.querySelector('div#originalImage img').onclick = function(e) {
    const {x, y} = getPixelCoordinates(e);

    getFileAsImageData(document.querySelector('input#imageUpload').files[0], (imageData) => {
      const clickedColor = getAverageColor(imageData, x, y, 2);
      const base64 = imageDataToBase64(highlightCloseColors(imageData, clickedColor));
      document.querySelector('img#highlighted').src = base64;
    });
  };


  originalImage.addEventListener('mousedown', (e) => {
    event.preventDefault();

    dragStart = {x: e.x, y: e.y};

    const dragBorder = document.createElement('div');
    dragBorder.id = 'dragBorder'
    dragBorder.style.position = 'fixed';
    dragBorder.style.left = `${dragStart.x}px`;
    dragBorder.style.top = `${dragStart.y}px`;
    dragBorder.style.border = '1px solid';
    originalImage.parentElement.append(dragBorder);
  });

  originalImage.addEventListener('mousemove', (e) => {
    event.preventDefault();

    if (dragStart) {
      const dragBorder = document.querySelector('div#dragBorder');
      dragBorder.style.width = `${e.x - dragStart.x}px`;
      dragBorder.style.height = `${e.y - dragStart.y}px`;
    }
  });

  originalImage.addEventListener('mouseup', (e) => {
    event.preventDefault();

    document.querySelector('div#dragBorder').remove();
    dragStart = undefined;
  });
}

// Get the coordinates of the clicked pixel
function getPixelCoordinates(e) {
  var ratioX = e.target.naturalWidth / e.target.offsetWidth;
  var ratioY = e.target.naturalHeight / e.target.offsetHeight;

  var domX = e.x + window.pageXOffset - e.target.offsetLeft;
  var domY = e.y + window.pageYOffset - e.target.offsetTop;

  var imgX = Math.floor(domX * ratioX);
  var imgY = Math.floor(domY * ratioY);

  return {x: imgX, y: imgY};
}


// Get the average color of the square with the side length of `2*spread+1` and centered on x, y
function getAverageColor(imageData, x, y, spread) {
  let rTotal = 0;
  let gTotal = 0;
  let bTotal = 0;
  let color;
  const numPixels = (2*spread + 1) ** 2;

  for (let i = x - spread; i <= x + spread; i++) {
    for (let col = y - spread; col <= y + spread; col++) {
      color = getPixelValues(imageData, i, col);
      rTotal += color.r;
      gTotal += color.g;
      bTotal += color.b;
    }
  }

  return {r: Math.round(rTotal/numPixels), g: Math.round(gTotal/numPixels), b: Math.round(bTotal/numPixels)};
}


function highlightCloseColors(imageData, color) {
  const numPixels = imageData.width * imageData.height;

  // For each pixel
  for (let i = 0; i < imageData.width; i++) {
    for (let j = 0; j < imageData.height; j++) {
      if (isCloseColor(color, getPixelValues(imageData, i, j))) {
        pixelIndex = imageData.width * j + i;
        imageData.data[pixelIndex * 4] = 255;
        imageData.data[pixelIndex * 4 + 1] = 0;
        imageData.data[pixelIndex * 4 + 2] = 255;
      }
    }
  }

  return imageData;
}

// Return the rgb values of the pixel in imageData at x, y
function getPixelValues(imageData, x, y) {
  // Calculate index of the pixel within the flattened array
  const i = imageData.width * y + x;

  // 4 channels in the imageData: r, g, b, a
  return {r: imageData.data[i * 4], g: imageData.data[i * 4 + 1], b: imageData.data[i * 4 + 2]};
}

function isCloseColor(color1, color2) {
  const rClose = Math.abs(color1.r - color2.r) < 30;
  const gClose = Math.abs(color1.g - color2.g) < 30;
  const bClose = Math.abs(color1.b - color2.b) < 30;

  return rClose && gClose && bClose;
}




// Convert imageData to base64 encoded image
function imageDataToBase64(imageData) {
  const canvas = document.createElement('canvas');
  canvas.height = imageData.height;
  canvas.width = imageData.width;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL();
}
