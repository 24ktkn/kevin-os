// =========================================================================
// 🧠 CONSOLIDATED MISSION CONTROL MASTER SCRIPT
// Contains: Google Fit Syncing + iOS/macOS Native App JSON API
// =========================================================================

// --- SECTION 1: GOOGLE FIT TO GOOGLE SHEETS AUTOMATIC SYNC ---

/**
 * Fetches the last 7 days of steps, bodyweight, sleep, RHR, and HRV 
 * from the Google Fit API and syncs them to the 'health_metrics' worksheet.
 */
function syncGoogleFitData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("health_metrics");
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("health_metrics");
    sheet.appendRow(["Date", "HRV", "Sleep Duration", "RHR", "Steps", "Bodyweight", "Wake Time"]);
  }
  
  var now = new Date();
  var torontoStr = Utilities.formatDate(now, "America/Toronto", "yyyy-MM-dd'T'00:00:00XXX");
  var midnightToday = new Date(torontoStr);
  var startTime = midnightToday.getTime() - (7 * 24 * 60 * 60 * 1000); // 7 days sync window
  var endTime = now.getTime();

  var token = ScriptApp.getOAuthToken();
  
  // Fetch each metric individually for API error resilience
  var stepsBuckets = fetchGoogleFitMetric("com.google.step_count.delta", startTime, endTime, token);
  var weightBuckets = fetchGoogleFitMetric("com.google.weight", startTime, endTime, token);
  var sleepSessions = fetchSleepSessions(startTime, endTime, token);
  var rhrBuckets = fetchGoogleFitMetric("com.google.resting_heart_rate.bpm", startTime, endTime, token);
  var hrSummaryBuckets = fetchGoogleFitMetric("com.google.heart_rate.bpm", startTime, endTime, token);
  var hrvBuckets = fetchGoogleFitMetric("com.google.heart_rate.variability", startTime, endTime, token);
  
  // Parse headers and indices
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var dateColIdx = headers.indexOf("Date");
  var hrvColIdx = headers.indexOf("HRV");
  var sleepColIdx = headers.indexOf("Sleep Duration");
  var rhrColIdx = headers.indexOf("RHR");
  var stepsColIdx = headers.indexOf("Steps");
  var weightColIdx = headers.indexOf("Bodyweight");
  
  var wakeTimeColIdx = headers.indexOf("Wake Time");
  if (wakeTimeColIdx === -1) {
    sheet.getRange(1, headers.length + 1).setValue("Wake Time");
    headers.push("Wake Time");
    wakeTimeColIdx = headers.indexOf("Wake Time");
  }
  
  if (dateColIdx === -1) {
    Logger.log("Date column not found in sheet.");
    return;
  }
  
  // Map existing dates to row numbers (1-indexed)
  var dateRowMap = {};
  for (var i = 1; i < data.length; i++) {
    var dVal = data[i][dateColIdx];
    if (dVal) {
      dateRowMap[formatDate(new Date(dVal))] = i + 1;
    }
  }
  
  var lastKnownWeight = getLastKnownWeight(sheet, weightColIdx);
  
  // Build continuous daily timeline structure
  var dailyData = {};
  for (var d = 0; d < 7; d++) {
    var date = new Date(now.getTime() - (d * 24 * 60 * 60 * 1000));
    var dateStr = formatDate(date);
    dailyData[dateStr] = { steps: 0, weight: lastKnownWeight, sleep: 0.0, rhr: 0, hrv: 0, wakeTime: "" };
  }
  
  // 1. Process Steps
  parseDailyBuckets(stepsBuckets, function(dateStr, points) {
    var sum = 0;
    points.forEach(function(p) {
      if (p.value && p.value[0]) sum += p.value[0].intVal || 0;
    });
    if (dailyData[dateStr]) dailyData[dateStr].steps = sum;
  });
  
  // 2. Process Bodyweight (KG to LBS)
  parseDailyBuckets(weightBuckets, function(dateStr, points) {
    if (points.length > 0) {
      var weightKg = points[0].value[0].fpVal || 0;
      if (weightKg > 0) {
        var weightLbs = Math.round(weightKg * 2.20462 * 10) / 10;
        if (dailyData[dateStr]) dailyData[dateStr].weight = weightLbs;
      }
    }
  });
  
  // 3. Process Sleep Duration & Wake Time from Sessions API
  sleepSessions.forEach(function(session) {
    var startMs = Number(session.startTimeMillis);
    var endMs = Number(session.endTimeMillis);
    var durationHours = (endMs - startMs) / (1000 * 60 * 60);
    
    var wakeDate = new Date(endMs);
    var wakeDateStr = formatDate(wakeDate);
    var wakeTimeStr = Utilities.formatDate(wakeDate, "America/Toronto", "hh:mm a");
    
    if (dailyData[wakeDateStr]) {
      dailyData[wakeDateStr].sleep += durationHours;
      dailyData[wakeDateStr].wakeTime = wakeTimeStr;
    }
  });
  
  // Round sleep values
  for (var dateStr in dailyData) {
    if (dailyData[dateStr].sleep > 0) {
      dailyData[dateStr].sleep = Math.round(dailyData[dateStr].sleep * 10) / 10;
    }
  }
  
  // 4. Process RHR
  parseDailyBuckets(rhrBuckets, function(dateStr, points) {
    if (points.length > 0) {
      var rhrVal = Math.round(points[0].value[0].fpVal || 0);
      if (rhrVal > 0 && dailyData[dateStr]) dailyData[dateStr].rhr = rhrVal;
    }
  });
  
  parseDailyBuckets(hrSummaryBuckets, function(dateStr, points) {
    if (points.length > 0 && dailyData[dateStr] && dailyData[dateStr].rhr === 0) {
      if (points[0].value && points[0].value[2]) {
        var minHr = Math.round(points[0].value[2].fpVal || 0);
        if (minHr > 0) dailyData[dateStr].rhr = minHr;
      }
    }
  });
  
  // 5. Process HRV
  parseDailyBuckets(hrvBuckets, function(dateStr, points) {
    if (points.length > 0) {
      var hrvVal = Math.round(points[0].value[0].fpVal || 0);
      if (hrvVal > 0 && dailyData[dateStr]) dailyData[dateStr].hrv = hrvVal;
    }
  });
  
  // Write variables back without wiping out manual metrics
  for (var dateStr in dailyData) {
    var metrics = dailyData[dateStr];
    var rowNum = dateRowMap[dateStr];
    
    if (rowNum) {
      var existingRowValues = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
      
      if (stepsColIdx !== -1 && (metrics.steps > 0 || !existingRowValues[stepsColIdx])) {
        sheet.getRange(rowNum, stepsColIdx + 1).setValue(metrics.steps);
      }
      if (weightColIdx !== -1 && (metrics.weight > 0 || !existingRowValues[weightColIdx])) {
        sheet.getRange(rowNum, weightColIdx + 1).setValue(metrics.weight);
      }
      if (sleepColIdx !== -1 && (metrics.sleep > 0 || !existingRowValues[sleepColIdx])) {
        sheet.getRange(rowNum, sleepColIdx + 1).setValue(metrics.sleep);
      }
      if (rhrColIdx !== -1 && (metrics.rhr > 0 || !existingRowValues[rhrColIdx])) {
        sheet.getRange(rowNum, rhrColIdx + 1).setValue(metrics.rhr);
      }
      if (hrvColIdx !== -1 && (metrics.hrv > 0 || !existingRowValues[hrvColIdx])) {
        sheet.getRange(rowNum, hrvColIdx + 1).setValue(metrics.hrv);
      }
      if (wakeTimeColIdx !== -1 && (metrics.wakeTime !== "" || !existingRowValues[wakeTimeColIdx])) {
        sheet.getRange(rowNum, wakeTimeColIdx + 1).setValue(metrics.wakeTime);
      }
    } else {
      var newRow = [];
      for (var c = 0; c < headers.length; c++) {
        if (c === dateColIdx) newRow.push(dateStr);
        else if (c === stepsColIdx) newRow.push(metrics.steps);
        else if (c === weightColIdx) newRow.push(metrics.weight);
        else if (c === sleepColIdx) newRow.push(metrics.sleep);
        else if (c === rhrColIdx) newRow.push(metrics.rhr);
        else if (c === hrvColIdx) newRow.push(metrics.hrv);
        else if (c === wakeTimeColIdx) newRow.push(metrics.wakeTime);
        else newRow.push(0);
      }
      sheet.appendRow(newRow);
      dateRowMap[dateStr] = sheet.getLastRow();
    }
  }
  
  syncWakeUpHabit(dailyData);
}

/**
 * Automatically logs the 'Wake Up On Time' habit (True/False) based on sleep end times.
 */
function syncWakeUpHabit(dailyData) {
  var habitsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Habits");
  if (!habitsSheet) return;
  
  var habitsData = habitsSheet.getDataRange().getValues();
  var habitsHeaders = habitsData[0];
  var habitsDateColIdx = habitsHeaders.indexOf("Date");
  
  var wakeHabitColIdx = habitsHeaders.indexOf("Wake Up On Time");
  if (wakeHabitColIdx === -1) {
    habitsSheet.getRange(1, habitsHeaders.length + 1).setValue("Wake Up On Time");
    habitsHeaders.push("Wake Up On Time");
    wakeHabitColIdx = habitsHeaders.indexOf("Wake Up On Time");
  }
  
  if (habitsDateColIdx === -1) return;
  
  var habitsRowMap = {};
  for (var j = 1; j < habitsData.length; j++) {
    var hDate = habitsData[j][habitsDateColIdx];
    if (hDate) {
      habitsRowMap[formatDate(new Date(hDate))] = j + 1;
    }
  }
  
  for (var dateStr in dailyData) {
    var metrics = dailyData[dateStr];
    if (metrics.wakeTime) {
      var timeParts = metrics.wakeTime.split(" ");
      var hm = timeParts[0].split(":");
      var hour = parseInt(hm[0], 10);
      var minute = parseInt(hm[1], 10);
      var isAm = timeParts[1].toLowerCase() === "am";
      
      var hour24 = hour;
      if (!isAm && hour < 12) hour24 += 12;
      if (isAm && hour === 12) hour24 = 0;
      
      var wakeMinutes = hour24 * 60 + minute;
      var targetMinutes = 8 * 60; // 8:00 AM target
      
      var wokeOnTime = (wakeMinutes <= targetMinutes);
      var hRowNum = habitsRowMap[dateStr];
      
      if (hRowNum) {
        habitsSheet.getRange(hRowNum, wakeHabitColIdx + 1).setValue(wokeOnTime);
      } else {
        var newHabitRow = [];
        for (var c = 0; c < habitsHeaders.length; c++) {
          if (c === habitsDateColIdx) newHabitRow.push(dateStr);
          else if (c === wakeHabitColIdx) newHabitRow.push(wokeOnTime);
          else newHabitRow.push(false);
        }
        habitsSheet.appendRow(newHabitRow);
        habitsRowMap[dateStr] = habitsSheet.getLastRow();
      }
    }
  }
}

// Google Fit API fetching and parsing helpers
function fetchGoogleFitMetric(dataType, startTime, endTime, token) {
  var url = "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate";
  var payload = {
    "aggregateBy": [{ "dataTypeName": dataType }],
    "bucketByTime": { "durationMillis": 86400000 },
    "startTimeMillis": startTime,
    "endTimeMillis": endTime
  };
  var response = UrlFetchApp.fetch(url, {
    method: "post",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() === 200) {
    return JSON.parse(response.getContentText()).bucket;
  }
  return null;
}

function fetchSleepSessions(startTimeMillis, endTimeMillis, token) {
  var startIso = new Date(startTimeMillis).toISOString();
  var endIso = new Date(endTimeMillis).toISOString();
  var url = "https://www.googleapis.com/fitness/v1/users/me/sessions" +
            "?startTime=" + encodeURIComponent(startIso) +
            "&endTime=" + encodeURIComponent(endIso) +
            "&activityType=72";
             
  var response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() === 200) {
    return JSON.parse(response.getContentText()).session || [];
  }
  return [];
}

function parseDailyBuckets(buckets, callback) {
  if (!buckets) return;
  for (var b = 0; b < buckets.length; b++) {
    var bucket = buckets[b];
    var startTimeMillis = Number(bucket.startTimeMillis);
    var dateStr = formatDate(new Date(startTimeMillis));
    var points = [];
    if (bucket.dataset && bucket.dataset[0] && bucket.dataset[0].point) {
      points = bucket.dataset[0].point;
    }
    callback(dateStr, points);
  }
}

function formatDate(date) {
  var d = new Date(date);
  var month = '' + (d.getMonth() + 1);
  var day = '' + d.getDate();
  var year = d.getFullYear();
  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;
  return [year, month, day].join('-');
}

function getLastKnownWeight(sheet, weightColIdx) {
  if (weightColIdx === -1) return 170.0;
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i > 0; i--) {
    var w = Number(data[i][weightColIdx]);
    if (w > 0) return w;
  }
  return 170.0;
}


// --- SECTION 2: SECURE NATIVE IOS APP JSON API ENDPOINTS ---

function doGet(e) {
  try {
    var now = new Date();
    var torontoDateStr = Utilities.formatDate(now, "America/Toronto", "yyyy-MM-dd");
    var localHour = parseInt(Utilities.formatDate(now, "America/Toronto", "HH"), 10);
    
    // Rollover at 2:00 AM
    var activeDateStr = torontoDateStr;
    if (localHour < 2) {
      var yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
      activeDateStr = Utilities.formatDate(yesterday, "America/Toronto", "yyyy-MM-dd");
    }
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var healthSheet = ss.getSheetByName("health_metrics");
    var habitsSheet = ss.getSheetByName("Habits");
    
    var response = {
      date: activeDateStr,
      biometrics: { steps: 0, sleep: 0.0, hrv: 0, rhr: 0, weight: 170.0, wakeTime: "No data" },
      habits: { wakeUpOnTime: false, gymWorkout: false, journaling: false }
    };
    
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
    
    var action = params.action;
    
    var now = new Date();
    var torontoDateStr = Utilities.formatDate(now, "America/Toronto", "yyyy-MM-dd");
    var localHour = parseInt(Utilities.formatDate(now, "America/Toronto", "HH"), 10);
    
    // Rollover at 2:00 AM
    var activeDateStr = torontoDateStr;
    if (localHour < 2) {
      var yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
      activeDateStr = Utilities.formatDate(yesterday, "America/Toronto", "yyyy-MM-dd");
    }
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // --- 1. HANDLE DIRECT BIOMETRIC UPLOAD FROM IOS SHORTCUT ---
    if (action === "upload_biometrics") {
      var healthSheet = ss.getSheetByName("health_metrics");
      if (!healthSheet) {
        healthSheet = ss.insertSheet("health_metrics");
        healthSheet.appendRow(["Date", "HRV", "Sleep Duration", "RHR", "Steps", "Bodyweight", "Wake Time"]);
      }
      
      var hData = healthSheet.getDataRange().getValues();
      var hHeaders = hData[0];
      var hDateCol = hHeaders.indexOf("Date");
      var hrvCol = hHeaders.indexOf("HRV");
      var sleepCol = hHeaders.indexOf("Sleep Duration");
      var rhrCol = hHeaders.indexOf("RHR");
      var stepsCol = hHeaders.indexOf("Steps");
      var weightCol = hHeaders.indexOf("Bodyweight");
      var wakeCol = hHeaders.indexOf("Wake Time");
      
      // Find row for today
      var targetRow = -1;
      for (var i = 1; i < hData.length; i++) {
        var rowDate = formatDateString(hData[i][hDateCol]);
        if (rowDate === activeDateStr) {
          targetRow = i + 1;
          break;
        }
      }
      
      var steps = params.steps !== undefined ? parseInt(params.steps, 10) : null;
      var sleep = params.sleep !== undefined ? parseFloat(params.sleep) : null;
      var hrv = params.hrv !== undefined ? parseInt(params.hrv, 10) : null;
      var rhr = params.rhr !== undefined ? parseInt(params.rhr, 10) : null;
      var weight = params.weight !== undefined ? parseFloat(params.weight) : null;
      var wakeTime = params.wakeTime !== undefined ? String(params.wakeTime).trim() : null;
      
      if (targetRow !== -1) {
        if (steps !== null && stepsCol !== -1) healthSheet.getRange(targetRow, stepsCol + 1).setValue(steps);
        if (sleep !== null && sleepCol !== -1) healthSheet.getRange(targetRow, sleepCol + 1).setValue(sleep);
        if (hrv !== null && hrvCol !== -1) healthSheet.getRange(targetRow, hrvCol + 1).setValue(hrv);
        if (rhr !== null && rhrCol !== -1) healthSheet.getRange(targetRow, rhrCol + 1).setValue(rhr);
        if (weight !== null && weightCol !== -1) healthSheet.getRange(targetRow, weightCol + 1).setValue(weight);
        if (wakeTime !== null && wakeCol !== -1) healthSheet.getRange(targetRow, wakeCol + 1).setValue(wakeTime);
      } else {
        // Create new row
        var newRow = [];
        for (var c = 0; c < hHeaders.length; c++) {
          if (c === hDateCol) newRow.push(activeDateStr);
          else if (c === stepsCol && steps !== null) newRow.push(steps);
          else if (c === sleepCol && sleep !== null) newRow.push(sleep);
          else if (c === hrvCol && hrv !== null) newRow.push(hrv);
          else if (c === rhrCol && rhr !== null) newRow.push(rhr);
          else if (c === weightCol && weight !== null) newRow.push(weight);
          else if (c === wakeCol && wakeTime !== null) newRow.push(wakeTime);
          else newRow.push("");
        }
        healthSheet.appendRow(newRow);
      }
      
      // Auto-trigger Wake Up On Time check if wakeTime was uploaded
      if (wakeTime) {
        var dailyData = {};
        dailyData[activeDateStr] = { wakeTime: wakeTime };
        syncWakeUpHabit(dailyData);
      }
      
      return ContentService.createTextOutput(JSON.stringify({ success: true, date: activeDateStr }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // --- 2. HANDLE TOGGLE HABIT ---
    var habitName = params.habit;
    var completed = parseBool(params.completed);
    
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
    
    var targetRow = -1;
    for (var j = 1; j < habData.length; j++) {
      var rowDate = formatDateString(habData[j][habDateCol]);
      if (rowDate === activeDateStr) {
        targetRow = j + 1;
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

// Format helpers
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
