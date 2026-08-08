import os

path = 'c:/Users/Kevin/Desktop/kevin-os/ios_app/consolidated_code_gs.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

target1 = """  // Build continuous daily timeline structure
  var dailyData = {};
  for (var d = 0; d < 7; d++) {
    var date = new Date(now.getTime() - (d * 24 * 60 * 60 * 1000));
    var dateStr = formatDate(date);
    dailyData[dateStr] = { steps: 0, weight: lastKnownWeight, sleep: 0.0, rhr: 0, hrv: 0, wakeTime: "" };
  }"""

replacement1 = """  // Build continuous daily timeline structure
  var dailyData = {};
  for (var d = 0; d < 7; d++) {
    var date = new Date(now.getTime() - (d * 24 * 60 * 60 * 1000));
    var dateStr = formatDate(date);
    dailyData[dateStr] = { steps: 0, weight: 0.0, sleep: 0.0, rhr: 0, hrv: 0, wakeTime: "" };
  }"""

target2 = """      if (weightColIdx !== -1 && (metrics.weight > 0 || !existingRowValues[weightColIdx])) {
        sheet.getRange(rowNum, weightColIdx + 1).setValue(metrics.weight);
      }"""

replacement2 = """      if (weightColIdx !== -1) {
        if (metrics.weight > 0) {
          sheet.getRange(rowNum, weightColIdx + 1).setValue(metrics.weight);
        } else if (!existingRowValues[weightColIdx] || existingRowValues[weightColIdx] === "") {
          sheet.getRange(rowNum, weightColIdx + 1).setValue(lastKnownWeight);
        }
      }"""

if target1 in content and target2 in content:
    content = content.replace(target1, replacement1)
    content = content.replace(target2, replacement2)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Successfully patched consolidated_code_gs.js")
else:
    print("Targets not found!")
    if target1 not in content:
        print("Target 1 not found.")
    if target2 not in content:
        print("Target 2 not found.")
