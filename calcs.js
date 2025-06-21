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

    image = new LeafDiskImage(e.target.files[0]);
    await image.processImage();
    document.querySelector('img#highlightedImage').src = image.getGradientImage();

    console.log(`Total time: ${Date.now() - startTime}`);
  }
}

// Calls the function with each row and col for the given ranges
// Indices are inclusive
function forEachRowCol(startRow, endRow, startCol, endCol, doSomething) {
  const values = [];

  for (let row = startRow; row <= endRow; row++) {


    for (let col = startCol; col <= endCol; col++) {
      // Use .bind(this) because otherwise the passed in function does not have the context
      values.push(doSomething(row, col));
    }
  }

  return values;
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
    let startTime = Date.now();
    let fileBase64 = await getFileContentsAsBase64(this.file);
    document.querySelector('img#originalImage').src = fileBase64;
    this.pixels = await base64ToPixels(fileBase64);

    // Set expected sizes for the leaf disks
    // Assume the image is a 3" wide index card and the leaf disks are 5/8"
    this.expectedLeafDiskDiameter = (this.pixels[0].length/3)*5/8;
    this.expectedLeafDiskPerimeter = Math.PI*this.expectedLeafDiskDiameter;
    console.log(`Load image: ${Date.now() - startTime}`);

    startTime = Date.now();
    // Gradient value is the total pixel brightness
    const diskEdgeFinder = new EdgeFinder(this.pixels, ({r, g, b}) => r + g + b);
    diskEdgeFinder.findEdges();
    this.edges = diskEdgeFinder.edges;
    console.log(`findEdges: ${Date.now() - startTime}`);


    console.log(this.edges)

    startTime = Date.now();
    this.leafDiskEdges = structuredClone(diskEdgeFinder.edges.filter(e => this.isEdgeCircular(e)));
    this.findNecroticBoundaries();

    console.log(`findNecroticBoundaries: ${Date.now() - startTime}`);


    console.log('this.pixels:');
    console.log(this.pixels);
  }

  // Return a base64 data url encoding of the gradients converted to a visualization
  getGradientImage() {
    return pixelsToBase64(this.pixels, ({row, col, gradient, isEdge, edgeIndex}) => {
      // Set the pixel color to the strength of the gradient
      // Edges will appear white and everything else black
      let color = {r: gradient/3, g: gradient/3, b: gradient/3};

      // If the edge is a leaf disk, highlight it
      if (isEdge && this.isEdgeCircular(this.edges[edgeIndex])) {
        color = {r: 0, g: 255, b: 0};
      }

      return color;
    });
  }

  /*
   * Helper methods
   */

  // Determine if an edge is a circle based on the ratio of height/width and the number of pixels
  isEdgeCircular({height, width, coordinates}) {
    const isSquare = this.isWithinTolerance(height, width, 0.1);
    const isCorrectPerimeter = coordinates.length*0.9 > this.expectedLeafDiskPerimeter;
    const isCorrectDiameter = this.isWithinTolerance(this.expectedLeafDiskDiameter, width, 0.1);

    return isSquare && isCorrectPerimeter && isCorrectDiameter;
  }

  // Determine if a number is within the given tolerance of another number
  isWithinTolerance(correctNum, num, tolerance) {
    return Math.abs(correctNum - num) < correctNum*tolerance;
  }

  findNecroticBoundaries() {
    for (const edge of this.leafDiskEdges) {
      // Find the boundaries
    }
  }
}


/* ============================================== */
// A class to handle edge finding processes
/* ============================================== */
class EdgeFinder {
  // Takes in a 2D array of pixels and a function used to calculate the gradient value
  constructor(pixels, calculatePixelValue) {
    this.pixels = pixels;
    this.height = this.pixels.length;
    this.width = this.pixels[0].length;
    this.calculatePixelValue = calculatePixelValue;
    this.strongGradientCoordinates = [];
  }

  // Find all edges in the file using the Canny edge detection algorithm
  // https://en.wikipedia.org/wiki/Canny_edge_detector
  findEdges() {
    // Skip smoothing step, scanned images are relatively low noise

    // Calculate the gradient and angle for each pixel
    // Use .bind(this) so that the function has the context when it is called
    let startTime = Date.now();
    forEachRowCol(0, this.height-1, 0, this.width-1, this.setGradientValues.bind(this));
    console.log(`set gradients: ${Date.now() - startTime}`);

    // If the pixel gradient is not the maximum of the 3 in line with the gradient direction, set it to 0
    // This ensures that we only have one pixel per edge
    // Thresholding done when setting the pixel gradients to improve performance
    startTime = Date.now();
    for (const {row, col} of this.strongGradientCoordinates) {
      if (this.isMaxGradient(row, col)) {
        this.pixels[row][col].isEdge = true;
      } else {
        this.pixels[row][col].gradient = 0;
        this.pixels[row][col].isEdge = false;
      }
    }
    console.log(`mark edges: ${Date.now() - startTime}`);

    // Create the coordinate arrays for all the connected edges
    startTime = Date.now();
    this.groupContinuousEdges();
    console.log(`groupContinuousEdges: ${Date.now() - startTime}`);

    // console.log(this.edges.filter(e => e.coordinates.length > 500))
    // console.log(this.edges.filter(e => e.coordinates.length > 500).map(e => this.isEdgeCircular(e)))
  }


  // Calculate and set the gradient and angle (converted to degrees and rounded to the nearest 45)
  setGradientValues(row, col) {
    const sumTop = this.sumPixelValues(row-1, row-1, col-1, col+1);
    const sumBottom = this.sumPixelValues(row+1, row+1, col-1, col+1);
    const verticalGradient = sumTop - sumBottom;
    const sumLeft = this.sumPixelValues(row-1, row+1, col-1, col-1);
    const sumRight = this.sumPixelValues(row-1, row+1, col+1, col+1);
    const horizontalGradient = sumLeft - sumRight;
    const totalGradient = Math.sqrt(verticalGradient**2 + horizontalGradient**2);

    // Handle gradient threshold here so we don't have to loop through the entire image in future steps
    // Canny edge detection normally includes a weak edge threshold as well,
    // but that is not needed here because the image will be dark leaves on a white background
    if (totalGradient > 500) {
      // Add this pixel to the list of strong gradients
      this.strongGradientCoordinates.push({row: row, col: col});

      // Set the values on the pixel
      this.pixels[row][col].gradient = totalGradient;
      const angleDegrees = Math.atan(verticalGradient/horizontalGradient)*180/Math.PI;
      this.pixels[row][col].gradientAngle = Math.round(angleDegrees/45)*45;
    }
  }

  // Get the sum of all pixel brightnesses for the given ranges (inclusive)
  // If the range goes out of bounds, it'll use the pixel on the edge
  sumPixelValues(startRow, endRow, startCol, endCol) {
    const values = forEachRowCol(startRow, endRow, startCol, endCol, (row, col) => {
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

      return this.calculatePixelValue(this.pixels[row][col]);
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
      // If the pixels is part of an edge and has not yet been put in a group, then group it and all the ones connected to it
      if (this.pixels[row][col].isEdge && !this.pixels[row][col].isGrouped) {
        const connectedPixels = this.findConnectedEdgePixels(row, col, this.edges.length);
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
    if (this.pixels[row]?.[col] === undefined || !this.pixels[row][col].isEdge || this.pixels[row][col].isGrouped) {
      throw new Error('findConnectedEdgePixels called with invalid pixel');
    } else {
      // Mark the pixel as grouped so that we don't process it again
      this.pixels[row][col].isGrouped = true;
      this.pixels[row][col].edgeIndex = edgeIndex;

      // Return an array including the current coordinates and all the neighboring edge pixels
      // Allow for gaps of 1px in case the edge has a discontinuity
      const pixelList = [{row: row, col: col}];

      for (var i = row-2; i <= row+2; i++) {
        for (var j = col-2; j <= col+2; j++) {
          if (this.pixels[i]?.[j] !== undefined && this.pixels[i][j].isEdge && !this.pixels[i][j].isGrouped) {
            pixelList.push(...this.findConnectedEdgePixels(i, j, edgeIndex));
          }
        }
      }

      return pixelList;
    }
  }
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
  forEachRowCol(0, pixels.length-1, 0, pixels[0].length-1, (row, col) => {
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
