import numpy
import pandas
import torch
from torch.utils.data import Dataset

class LeafDiskDataset(Dataset):
  """
  Leaf disk dataset
  Contains:
    tree
    score
    RGB avgs and necrotic percent grouped by distance from the center
  """

  def __init__(self, csv_file):
    self.leaf_disk_frame = pandas.read_csv(csv_file)

  def __len__(self):
    return len(self.leaf_disk_frame)

  def __getitem__(self, index):
    values = numpy.array([self.leaf_disk_frame.iloc[index, 2:]], dtype=float)
    score = self.leaf_disk_frame.iloc[index, 1]

    return values, score
