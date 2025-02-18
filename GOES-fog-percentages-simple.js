// ============================== //
// GOES-16 Monthly Fog Percentage //
// Author: Jacob Nesslage         //
// Date created: 02/17/2025      //
// Date modified: 02/17/2025     //
// ==============================//

// ======================== //
// 1. DEFINE REGION & TIME //
// ======================== //

// Define the **Region of Interest (ROI)**
// The selected area is along the Santa Barbara coastline.
var roi = ee.Geometry.Rectangle([-120.7, 35, -119.7, 34.3]); 

// Define the **Time Range** (July - August 2023)
var startYear = 2023;
var startMonth = 7;
var endMonth = 8;

// Convert start and end month to Earth Engine date format
var startDate = ee.Date.fromYMD(startYear, startMonth, 1);
var endDate = startDate.advance(1, 'month');

// ========================== //
// 2. LOAD GOES-16 DATA //
// ========================== //

// Load the GOES-16 Multi-Channel Cloud and Moisture Imagery product (MCMIPF)
// This dataset contains various bands, including cloud temperature and brightness values.
var goesCollection = ee.ImageCollection('NOAA/GOES/16/MCMIPF')
  .filterDate(startDate, endDate) // Select images within the specified date range
  .filterBounds(roi); // Filter images that cover the region of interest

// Select a single image for **debugging and visualization**
var singleImage = goesCollection.first();
print('Single GOES Image:', singleImage);

// ======================================= //
// 3. APPLY SCALE & OFFSET TO CONVERT DATA //
// ======================================= //

// Function: Convert GOES-16 brightness values to **real temperature (Kelvin)**
var applyScaleAndOffset = function(image) {
  var bands = ['CMI_C13', 'CMI_C07', 'CMI_C14']; // Bands needed for fog detection
  
  var scaledBands = bands.map(function(band) {
    var scale = ee.Number(image.get(band + '_scale'));  // Get scale factor from metadata
    var offset = ee.Number(image.get(band + '_offset')); // Get offset from metadata
    return image.select(band).multiply(scale).add(offset).rename('BT_' + band); // Apply correction
  });

  return image.addBands(ee.Image(scaledBands)); // Return updated image with corrected temperature bands
};

// Apply the scaling function to all images in the collection
var scaledCollection = goesCollection.map(applyScaleAndOffset);

// ========================== //
// 4. REPROJECT & CLIP DATA //
// ========================== //

// Function: Reproject GOES-16 data to WGS84 (Lat/Lon) before clipping to ROI
var reprojectAndClip = function(image) {
  var reproj = image.reproject({
    crs: 'EPSG:4326', // Convert GOES geostationary projection to standard lat/lon
    scale: 2000 // Set resolution (~2km per pixel, which matches GOES data)
  }).clip(roi); // Clip to study region

  return reproj;
};

// Apply reprojection & clipping
var processedCollection = scaledCollection.map(reprojectAndClip);

// ========================== //
// 5. EXTRACT RELEVANT BANDS //
// ========================== //

// Select a single image **after reprojection** for debugging
var scaledImage = processedCollection.first();

// Extract **Cloud Top Temperature (CTT)** in Kelvin
var band13 = scaledImage.select('BT_CMI_C13'); 

// Extract **Brightness Temperature at 3.9 µm (BTD numerator)**
var band7 = scaledImage.select('BT_CMI_C07');  

// Extract **Brightness Temperature at 11.2 µm (BTD denominator)**
var band14 = scaledImage.select('BT_CMI_C14');  

// Compute **Brightness Temperature Difference (BTD)**
var btd = band7.subtract(band14); // BTD = Band 7 (3.9µm) - Band 14 (11.2µm)

// ========================== //
// 6. DETECT CLOUDS & FOG //
// ========================== //

// **Step 1: Identify All Cloud Pixels**
// Clouds have relatively cold cloud tops, so we use a threshold to detect them.
var cloudMask = band13.lt(273); // Cloud Top Temperature < 273K indicates high-altitude clouds

// **Step 2: Identify Fog Pixels**
// Fog is a low cloud with a distinct thermal signature.
// Condition: **Warm cloud tops (CTT > 273K) AND Positive BTD (>2K)**
var fogMask = band13.gt(273).and(btd.gt(2)).and(cloudMask.not()); 

// ========================== //
// 7. VISUALIZE INTERMEDIATE DATA //
// ========================== //

Map.centerObject(roi, 6);

// **Step 1: Show Cloud Top Temperature**
Map.addLayer(band13, {min: 260, max: 300, palette: ['blue', 'yellow', 'red']}, 'Cloud Top Temperature (K)');

// **Step 2: Show Brightness Temperature Difference (BTD)**
Map.addLayer(btd, {min: -5, max: 5, palette: ['red', 'yellow', 'green']}, 'Brightness Temp Difference (BTD)');

// **Step 3: Show All Cloud Pixels (Red)**
Map.addLayer(cloudMask.updateMask(cloudMask), {palette: ['red']}, 'All Cloud Pixels');

// **Step 4: Show Final Fog Mask (White)**
Map.addLayer(fogMask.updateMask(fogMask), {palette: ['white']}, 'Fog Mask (1=Fog, 0=Clear)');

// ========================== //
// 8. CALCULATE MONTHLY FOG COVER //
// ========================== //

// Function: Apply fog detection logic to each image in the collection
var fogCollection = processedCollection.map(function(img) {
  var band13 = img.select('BT_CMI_C13');
  var band7 = img.select('BT_CMI_C07');
  var band14 = img.select('BT_CMI_C14');

  var btd = band7.subtract(band14);
  var cloudMask = band13.lt(273); // Detect high clouds
  var fog = band13.gt(273).and(btd.gt(2)).and(cloudMask.not()); // Apply fog rule

  return fog.rename('fogMask'); // Return binary fog mask (1=Fog, 0=No Fog)
});

// **Step 1: Count Fog Occurrences**
var fogCount = fogCollection.sum(); // Sum up all instances of fog across images

// **Step 2: Count Total Observations Per Pixel**
var totalCount = fogCollection.map(function(img) {
  return img.unmask(0).gte(0); // Ensure all pixels are counted
}).sum();

// **Step 3: Compute Monthly Fog Percentage**
var fogPercentage = fogCount.divide(totalCount).multiply(100); 

// ========================== //
// 9. VISUALIZE FINAL OUTPUT //
// ========================== //

Map.addLayer(fogPercentage, {min: 0, max: 100, palette: ['blue', 'white']}, 'Final Monthly Fog Cover');

// ========================== //
// 10. PRINT DEBUG INFORMATION //
// ========================== //
print('Cloud Top Temperature (K):', band13);
print('Brightness Temperature Difference (BTD):', btd);
print('Cloud Mask (1=Cloud, 0=Clear):', cloudMask);
print('Fog Mask:', fogMask);
print('Fog Count:', fogCount);
print('Total Observations:', totalCount);
print('Final Fog Percentage:', fogPercentage);
