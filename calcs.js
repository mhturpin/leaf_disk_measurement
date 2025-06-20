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

class LeafDiskImage {
  constructor(file) {
    this.file = file;
    this.strongGradientCoordinates = [];
  }

  // Do all the image processing from loading the file to determining necrotic areas
  async processImage() {
    // TODO: might need to wrap this in a promise
    let fileBase64 = await this.getFileContentsAsBase64();
    document.querySelector('img#originalImage').src = fileBase64;
    this.pixels = await this.base64ToPixels(fileBase64);
    // Assume the image is a 3" wide index card and the leaf disks are 5/8"
    this.expectedLeafDiskDiameter = (this.pixels[0].length/3)*5/8;
    this.expectedLeafDiskPerimeter = Math.PI*this.expectedLeafDiskDiameter;

    let startTime = Date.now();
    this.findEdges();
    console.log(`findEdges: ${Date.now() - startTime}`);


    console.log('this.pixels:');
    console.log(this.pixels);
  }

  // Return a base64 data url encoding of the gradients converted to a visualization
  getGradientImage() {
    return this.pixelsToBase64(({row, col, gradient, isEdge, edgeIndex}) => {
      // Set the pixel color to the strength of the gradient
      // Edges will appear white and everything else black
      let color = {r: gradient/3, g: gradient/3, b: gradient/3};

      // If the edge is longer, highlight it
      if (isEdge && this.edges[edgeIndex].length > this.expectedLeafDiskPerimeter*0.75) {
        color = {r: 0, g: 255, b: 0};
      }

      return color;
    });
  }

  /*
   * Helper methods
   */
  // Load the file contents as a base64 data url
  getFileContentsAsBase64() {
    return new Promise((resolve) => {
      const reader = new FileReader();
      // Set the callback to resolve with the base64 file contents
      reader.onloadend = () => resolve(reader.result);
      // Read the file, which triggers the callback when it's done
      reader.readAsDataURL(this.file);
    });
  }

  // Convert the base64 data url file contents to a 2D array of pixels with rgb values
  base64ToPixels(base64) {
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

  // Find all edges in the file using the Canny edge detection algorithm
  // https://en.wikipedia.org/wiki/Canny_edge_detector
  findEdges() {
    // Skip smoothing step, scanned images are relatively low noise

    // Calculate the gradient and angle for each pixel
    this.forEachPixel(this.setGradientValues);

    // If the pixel gradient is not the maximum of the 3 in line with the gradient direction, set it to 0
    // This ensures that we only have one pixel per edge
    // Thresholding done when setting the pixel gradients to improve performance
    for (const {row, col} of this.strongGradientCoordinates) {
      if (!this.isMaxGradient(row, col)) {
        this.pixels[row][col].gradient = 0;
        this.pixels[row][col].isEdge = false;
      } else {
        this.pixels[row][col].isEdge = true;
      }
    }

    // Create the coordinate arrays for all the connected edges
    this.groupContinuousEdges();

    console.log('this.edges:');
    console.log(this.edges);
  }

  // Calls the function with row and col for each pixel in the image
  forEachPixel(doSomething) {
    for (let row = 0; row < this.pixels.length; row++) {
      for (let col = 0; col < this.pixels[row].length; col++) {
        // Use .bind(this) because otherwise the passed in function does not have the context
        doSomething.bind(this)(row, col);
      }
    }
  }

  // Calculate and set the gradient and angle (converted to degrees and rounded to the nearest 45)
  setGradientValues(row, col) {
    const sumTop = this.sumPixelBrightnesses([row-1, row-1], [col-1, col+1]);
    const sumBottom = this.sumPixelBrightnesses([row+1, row+1], [col-1, col+1]);
    const verticalGradient = sumTop - sumBottom;
    const sumLeft = this.sumPixelBrightnesses([row-1, row+1], [col-1, col-1]);
    const sumRight = this.sumPixelBrightnesses([row-1, row+1], [col+1, col+1]);
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

  // Return the total brightness value for a pixel
  pixelBrightness(row, col) {
    return this.pixels[row][col].r + this.pixels[row][col].g + this.pixels[row][col].b;
  }

  // Get the sum of all pixel brightnesses for the given ranges (inclusive)
  // If the range goes out of bounds, it'll the pixel on the edge
  sumPixelBrightnesses(rowIndices, colIndices) {
    let sum = 0;

    for (let row = rowIndices[0]; row <= rowIndices[1]; row++) {
      for (let col = colIndices[0]; col <= colIndices[1]; col++) {
        let currentRow = row;
        let currentCol = col;

        if (row < 0) {
          currentRow = 0;
        } else if (row >= this.pixels.length) {
          currentRow = this.pixels.length-1;
        }

        if (col < 0) {
          currentCol = 0;
        } else if (col >= this.pixels[0].length) {
          currentCol = this.pixels[0].length-1;
        }

        sum += this.pixelBrightness(currentRow, currentCol);
      }
    }

    return sum;
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
        this.edges.push(this.findConnectedEdgePixels(row, col, this.edges.length));
      }
    }
  }

  // Return a coordinate array of all edge pixels connected to the pixel at the given coordinates
  // The edgeIndex parameter identifies which edge the pixel is getting grouped into
  findConnectedEdgePixels(row, col, edgeIndex) {
    if (this.pixels[row]?.[col] === undefined || !this.pixels[row][col].isEdge || this.pixels[row][col].isGrouped) {
      // If the pixel is not an edge, is not a valid pixel (index out of bounds), or has already been processed, return
      return [];
    } else {
      // Mark the pixel as grouped so that we don't process it again
      this.pixels[row][col].isGrouped = true;
      this.pixels[row][col].edgeIndex = edgeIndex;

      // Return an array including the current coordinates and all the neighboring edge pixels
      // Allow for gaps of 1px in case the edge has a discontinuity
      const pixelList = [{row: row, col: col}];

      for (var i = row-2; i <= row+2; i++) {
        for (var j = col-2; j <= col+2; j++) {
          pixelList.push(...this.findConnectedEdgePixels(i, j, edgeIndex));
        }
      }

      return pixelList;
    }
  }

  // Converts the pixels into a base64 data URL
  // Takes a transformation that returns an object with keys r, g, and b
  pixelsToBase64(transformation) {
    const height = this.pixels.length;
    const width = this.pixels[0].length;
    const imageData = new ImageData(width, height);

    // Populate imageData with pixel values
    this.forEachPixel((row, col) => {
      const {r, g, b} = transformation(this.pixels[row][col]);
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
}
