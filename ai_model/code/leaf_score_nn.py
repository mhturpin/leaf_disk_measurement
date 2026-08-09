import torch
import torch.nn as nn

class LeafScoreNN(nn.Module):
  def __init__(self):
    super(LeafScoreNN, self).__init__()
    # fc = fully connected layer
    self.fc1 = nn.Linear(200, 20)
    self.fc2 = nn.Linear(20, 20)
    self.fc3 = nn.Linear(20, 1)

  def forward(self, x):
    x = torch.relu(self.fc1(x))
    x = torch.relu(self.fc2(x))
    x = self.fc3(x)
    return x
