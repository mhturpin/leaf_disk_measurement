from leaf_disk_dataset import LeafDiskDataset
from leaf_score_nn import LeafScoreNN

from datetime import datetime
import matplotlib.pyplot as plt
import torch
from torch.utils.data import DataLoader

# Accelerator should be mps (apple silicon gpu)
device = torch.accelerator.current_accelerator().type if torch.accelerator.is_available() else "cpu"
print(f'Using device: {device}')

# Load the dataset
train_set = LeafDiskDataset(csv_file='../data/sample_train.csv')
train_loader = DataLoader(train_set, batch_size=64, shuffle=True, num_workers=0)

validate_set = LeafDiskDataset(csv_file='../data/sample_validate.csv')
validate_loader = DataLoader(validate_set, batch_size=64, shuffle=False, num_workers=0)

test_set = LeafDiskDataset(csv_file='../data/sample_test.csv')
test_loader = DataLoader(test_set, batch_size=64, shuffle=False, num_workers=0)

# Instantiate the model, loss function, and optimizer
model = LeafScoreNN()
criterion = torch.nn.MSELoss()
optimizer = torch.optim.SGD(model.parameters(), lr=0.0001)

# Tracking datapoints
best_vloss = 1_000_000
timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
losses = []
vlosses = []

# Training loop
num_epochs = 50

for epoch in range(num_epochs):
  # Set model to training mode
  model.train()

  total_loss = 0

  for i, data in enumerate(train_loader):
    batch_values, batch_scores = data

    # Convert numpy arrays to torch tensors
    batch_values = batch_values.to(torch.float32)
    batch_scores = batch_scores.to(torch.float32)

    # Zero the parameter gradients
    optimizer.zero_grad()

    # Forward pass, .squeeze() to remove redundant dimensions
    outputs = model(batch_values).squeeze()
    loss = criterion(outputs, batch_scores)

    # Backward pass and optimization
    loss.backward()
    optimizer.step()

    # Collect reporting data
    total_loss += loss.item()

  avg_loss = total_loss / (i + 1)
  losses.append(avg_loss)

  # Set model to evaluation mode
  model.eval()

  running_vloss = 0

  # Disable gradient computation to reduce memory consumption
  with torch.no_grad():
    for i, vdata in enumerate(validate_loader):
      vvalues, vscores = vdata
      vvalues = vvalues.to(torch.float32)
      vscores = vscores.to(torch.float32)

      voutputs = model(vvalues)
      vloss = criterion(voutputs, vscores)
      running_vloss += vloss

  avg_vloss = running_vloss / (i + 1)
  vlosses.append(avg_vloss)

  if epoch%5 == 4:
    print(f'Epoch [{epoch+1}/{num_epochs}], Training Loss: {avg_loss:.4f}, Validation Loss: {avg_vloss:.4f}')

  # Track best performance, and save the model's state if it is the current best
  if avg_vloss < best_vloss:
    best_vloss = avg_vloss
    model_path = f'../models/{timestamp}_{epoch}'
    torch.save(model.state_dict(), model_path)

# Plot the losses
plt.plot(losses)
plt.plot(vlosses)
plt.xlabel('Epoch')
plt.ylabel('Loss')
plt.title('Training/Validation Loss')
plt.ylim(0, 1) # Limit to 1 so initial losses don't obsure the rest
plt.show()
