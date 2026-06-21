# https://github.com/collinswakholi/ColorCorrectionPackage
import os
import sys
import cv2
import numpy as np
import pandas as pd

from ColorCorrectionPipeline import ColorCorrection, Config
from ColorCorrectionPipeline.core.utils import to_float64
from ColorCorrectionPipeline.io import write_image

# ─────────────────────────────────────────────────────────────────────────────
# 1. File paths
# ─────────────────────────────────────────────────────────────────────────────
IMG_PATH = sys.argv[1]

# Output directory (only used if config.save=True)
SAVE_PATH = os.path.join(os.getcwd(), "results")
print(SAVE_PATH)

# ─────────────────────────────────────────────────────────────────────────────
# 2. Load images and convert to RGB float64 in [0,1]
# ─────────────────────────────────────────────────────────────────────────────
img_bgr   = cv2.imread(IMG_PATH)
img_rgb   = to_float64(img_bgr[:, :, ::-1])  # convert to RGB (64bit floats, 0-1, RGB)
img_name = os.path.splitext(os.path.basename(IMG_PATH))[0]

# ─────────────────────────────────────────────────────────────────────────────
# 3. Configure per‐stage parameters
# ─────────────────────────────────────────────────────────────────────────────

ffc_kwargs = {
  "manual_crop": False,           # Optional, for manual white plane ROI selection
  "show": False,                  # Whether to show intermediate plots
  "bins": 50,                     # Number of bins used for sampling the intensity profile of the white plane
  "smooth_window": 5,             # Window size for smoothing the intensity profile
  "get_deltaE": True,             # Whether to calculate and return deltaE (CIEDE2000)
  "fit_method": "pls",            # can be linear, nn, pls, or svm, default is linear
  "interactions": True,           # Whether to include interactions in the polynomial expansion
  "max_iter": 1000,               # Maximum number of iterations
  "tol": 1e-8,                    # Tolerance for stopping criterion
  "verbose": False,               # Whether to print verbose output
  "random_seed": 0,               # Random seed
  "cache_multiplier": True,       # Reuse multiplier for same white image/config
}

# Gamma Correction (GC) kwargs:
gc_kwargs = {
  "max_degree": 5,                # Maximum polynomial degree for fitting gamma profile
  "show": False,                  # Whether to show intermediate plots
  "get_deltaE": True,             # Whether to calculate and return deltaE (CIEDE2000)
}

# White Balance (WB) kwargs:
wb_kwargs = {
  "show": False,                  # Whether to show intermediate plots
  "get_deltaE": True,             # Whether to calculate and return deltaE (CIEDE2000)
}

# Color Correction (CC) kwargs:
cc_kwargs = {
  'cc_method': 'ours',            # method to use for color correction
  'method': 'Finlayson 2015',     # if cc_method is 'conv', this is the method
  'mtd': 'nn',                    # if cc_method is 'ours', this is the method, linear, nn, pls

  'degree': 2,                    # degree of polynomial to fit
  'max_iterations': 10000,        # max iterations for fitting
  'random_state': 0,              # random seed
  'tol': 1e-8,                    # tolerance for fitting
  'verbose': False,               # whether to print verbose output
  'param_search': False,          # whether to use parameter search
  'show': False,                  # whether to show plots
  'get_deltaE': True,             # whether to compute deltaE
  'n_samples': 50,                # number of samples to use for parameter search

  # only if mtd == 'pls' otherwise disable
  # 'ncomp': 1,                     # number of components to use

  # only if mtd == 'nn' or mtd == 'custom' otherwise disable
  'hidden_layers': [64],          # recommended hidden layer size for sklearn NN
  'learning_rate': 0.001,         # learning rate for neural network
  'batch_size': 16,               # batch size for neural network
  'patience': 10,                 # patience for early stopping
  'dropout_rate': 0.2,            # dropout rate for neural network
  'optim_type': 'adam',           # optimizer type for neural network
  'use_batch_norm': False,        # only used by mtd == 'custom'
  'use_lut': True,                # use 3-D LUT acceleration for image prediction
  'lazy_lut': True,               # build LUT only when first needed
  'lut_grid_size': 33,            # 3-D LUT grid resolution
  'lut_min_pixels': 4096,         # direct-predict small arrays below this size
}

# ─────────────────────────────────────────────────────────────────────────────
# 4. Build Config and run the Training Pipeline
# ─────────────────────────────────────────────────────────────────────────────
config = Config(
  do_ffc=True,                    # Change to False if you don't want to run FFC
  do_gc=True,                     # Change to False if you don't want to run GC
  do_wb=True,                     # Change to False if you don't want to run WB
  do_cc=True,                     # Change to False if you don't want to run CC
  save=False,                     # Change to True if you want to save models + CSVs
  save_path=SAVE_PATH,            # Directory for saving outputs (models & CSV)
  check_saturation=True,          # Change to False if you don't want to check if color chart patches are saturated
  REF_ILLUMINANT=None,            # Defaults to D65; supply np.ndarray if needed
  FFC_kwargs=ffc_kwargs,
  GC_kwargs=gc_kwargs,
  WB_kwargs=wb_kwargs,
  CC_kwargs=cc_kwargs,
)

cc = ColorCorrection()
metrics, corrected_imgs, errors = cc.run(
  Image=img_rgb,
  name_=img_name,
  config=config,
)

# Use calculated correction to convert and save the image
prediction = cc.predict_image(IMG_PATH, show=False)
OUT_DIR = 'corrected_images'
os.makedirs(OUT_DIR, exist_ok=True)
path = f"{OUT_DIR}/{img_name}.png"

write_image(path, prediction['CC'])
