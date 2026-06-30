# Google Apps Script Web App API Deployment Guide

To connect your iOS app to your Google Sheet, you need to add JSON API functionality to your Google Sheet's Apps Script project and publish it as a public **Web App**.

---

### Step 1: Open Apps Script
1. Open your Google Sheet in your browser.
2. In the top menu, click **Extensions** $\rightarrow$ **Apps Script**.

---

### Step 2: Append the API Code
1. Open `Code.gs` in the editor.
2. Scroll to the absolute bottom of the file (below your existing `syncGoogleFitData` code).
3. Paste the following `doGet` and `doPost` API endpoints:

```javascript
// ==========================================
// 🧠 NATIVE IOS APP JSON API ENDPOINTS
// ==========================================

function doGet(e) {
  try {
    var now = new Date();
    // Timezone alignment to Toronto
    var torontoDateStr = Utilities.formatDate(now, "America/Toronto", "yyyy-MM-dd");
    var localHour = parseInt(Utilities.formatDate(now, "America/Toronto", "HH"), 10);
    
    // 2:00 AM Night-Owl Rollover logic
    var activeDateStr = torontoDateStr;
    if (localHour < 2) {
      var yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
      activeDateStr = Utilities.formatDate(yesterday, "America/Toronto", "yyyy-MM-dd");
    }
    
    // Get Sheets
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var healthSheet = ss.getSheetByName("health_metrics");
    var habitsSheet = ss.getSheetByName("Habits");
    
    var response = {
      date: activeDateStr,
      biometrics: { steps: 0, sleep: 0.0, hrv: 0, rhr: 0, weight: 170.0, wakeTime: "No data" },
      habits: { wakeUpOnTime: false, gymWorkout: false, journaling: false }
    };
    
    // Read health_metrics
    if (healthSheet) {
      var hData = healthSheet.getDataRange().getValues();
      var hHeaders = hData[0];
      var hDateCol = hHeaders.indexOf("Date");
      var stepsCol = hHeaders.indexOf("Steps");
      var sleepCol = hHeaders.indexOf("Sleep Duration");
      var hrvCol = hHeaders.indexOf("HRV");
      var rhrCol = hHeaders.indexOf("RHR");
      var weightCol = hHeaders.indexOf("Bodyweight");
      var wakeCol = hHeaders.indexOf("Wake Time");
      
      // Look for active date row
      for (var i = hData.length - 1; i > 0; i--) {
        var rowDate = formatDateString(hData[i][hDateCol]);
        if (rowDate === activeDateStr) {
          if (stepsCol !== -1) response.biometrics.steps = parseInt(hData[i][stepsCol], 10) || 0;
          if (sleepCol !== -1) response.biometrics.sleep = parseFloat(hData[i][sleepCol]) || 0.0;
          if (hrvCol !== -1) response.biometrics.hrv = parseInt(hData[i][hrvCol], 10) || 0;
          if (rhrCol !== -1) response.biometrics.rhr = parseInt(hData[i][rhrCol], 10) || 0;
          if (weightCol !== -1) response.biometrics.weight = parseFloat(hData[i][weightCol]) || 170.0;
          if (wakeCol !== -1 && hData[i][wakeCol]) response.biometrics.wakeTime = String(hData[i][wakeCol]).trim();
          break;
        }
      }
    }
    
    // Read Habits
    if (habitsSheet) {
      var habData = habitsSheet.getDataRange().getValues();
      var habHeaders = habData[0];
      var habDateCol = habHeaders.indexOf("Date");
      var wakeHabCol = habHeaders.indexOf("Wake Up On Time");
      var gymHabCol = habHeaders.indexOf("Gym Workout");
      var journHabCol = habHeaders.indexOf("Journaling");
      
      for (var j = habData.length - 1; j > 0; j--) {
        var rowDate = formatDateString(habData[j][habDateCol]);
        if (rowDate === activeDateStr) {
          if (wakeHabCol !== -1) response.habits.wakeUpOnTime = parseBool(habData[j][wakeHabCol]);
          if (gymHabCol !== -1) response.habits.gymWorkout = parseBool(habData[j][gymHabCol]);
          if (journHabCol !== -1) response.habits.journaling = parseBool(habData[j][journHabCol]);
          break;
        }
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var params;
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    } else {
      params = e.parameter;
    }
    
    var habitName = params.habit; // "Wake Up On Time", "Gym Workout", or "Journaling"
    var completed = parseBool(params.completed);
    
    var now = new Date();
    var torontoDateStr = Utilities.formatDate(now, "America/Toronto", "yyyy-MM-dd");
    var localHour = parseInt(Utilities.formatDate(now, "America/Toronto", "HH"), 10);
    
    var activeDateStr = torontoDateStr;
    if (localHour < 2) {
      var yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
      activeDateStr = Utilities.formatDate(yesterday, "America/Toronto", "yyyy-MM-dd");
    }
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var habitsSheet = ss.getSheetByName("Habits");
    
    if (!habitsSheet) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Habits sheet not found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var habData = habitsSheet.getDataRange().getValues();
    var habHeaders = habData[0];
    var habDateCol = habHeaders.indexOf("Date");
    var targetColIdx = habHeaders.indexOf(habitName);
    
    if (habDateCol === -1 || targetColIdx === -1) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Date or Habit column not found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Find row
    var targetRow = -1;
    for (var j = 1; j < habData.length; j++) {
      var rowDate = formatDateString(habData[j][habDateCol]);
      if (rowDate === activeDateStr) {
        targetRow = j + 1; // 1-indexed row number
        break;
      }
    }
    
    if (targetRow !== -1) {
      habitsSheet.getRange(targetRow, targetColIdx + 1).setValue(completed);
    } else {
      var newRow = [];
      for (var c = 0; c < habHeaders.length; c++) {
        if (c === habDateCol) newRow.push(activeDateStr);
        else if (c === targetColIdx) newRow.push(completed);
        else newRow.push(false);
      }
      habitsSheet.appendRow(newRow);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ success: true, date: activeDateStr }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Helper formatting utilities
function formatDateString(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, "America/Toronto", "yyyy-MM-dd");
  }
  return String(val).split("T")[0].trim();
}

function parseBool(val) {
  if (typeof val === "boolean") return val;
  var str = String(val).toLowerCase().trim();
  return str === "true" || str === "1";
}
```

4. Save the file (Press `Cmd + S` / `Ctrl + S`).

---

### Step 3: Deploy as a Web App
1. In the top right corner of the Apps Script page, click the blue **Deploy** button $\rightarrow$ select **New deployment**.
2. Click the gear icon next to "Select type" $\rightarrow$ select **Web app**.
3. Configure the deployment details:
   - **Description**: `KevinOS Dashboard Native iOS API`
   - **Execute as**: `Me (your email)`
   - **Who has access**: **`Anyone`** (This is crucial, as it allows your iOS app/widget to communicate with the endpoint without OAuth dialogs).
4. Click **Deploy**.
5. Copy the **Web App URL** generated (it will look like `https://script.google.com/macros/s/.../exec`).
6. **Save this URL!** You will paste it directly into your Swift app's `NetworkManager.swift` file.
