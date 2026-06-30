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
    var workoutSheet = ss.getSheetByName("workout_logs");
    var costcoSheet = ss.getSheetByName("Costco_MealPlan");
    
    var response = {
      date: activeDateStr,
      biometrics: { steps: 0, sleep: 0.0, hrv: 0, rhr: 0, weight: 170.0, wakeTime: "No data" },
      habits: { wakeUpOnTime: false, gymWorkout: false, journaling: false },
      habitHistory: [],
      recentWorkouts: [],
      costcoItems: []
    };
    
    // 1. Fetch Today's Biometrics
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
    
    // 2. Fetch Today's Habits & 7-day History
    if (habitsSheet) {
      var habData = habitsSheet.getDataRange().getValues();
      var habHeaders = habData[0];
      var habDateCol = habHeaders.indexOf("Date");
      var wakeHabCol = habHeaders.indexOf("Wake Up On Time");
      var gymHabCol = habHeaders.indexOf("Gym Workout");
      var journHabCol = habHeaders.indexOf("Journaling");
      
      // Get Today's Status
      for (var j = habData.length - 1; j > 0; j--) {
        var rowDate = formatDateString(habData[j][habDateCol]);
        if (rowDate === activeDateStr) {
          if (wakeHabCol !== -1) response.habits.wakeUpOnTime = parseBool(habData[j][wakeHabCol]);
          if (gymHabCol !== -1) response.habits.gymWorkout = parseBool(habData[j][gymHabCol]);
          if (journHabCol !== -1) response.habits.journaling = parseBool(habData[j][journHabCol]);
          break;
        }
      }
      
      // Get 7-day History (last 7 rows)
      var startRow = Math.max(1, habData.length - 7);
      for (var k = habData.length - 1; k >= startRow; k--) {
        var rDate = formatDateString(habData[k][habDateCol]);
        if (rDate) {
          response.habitHistory.push({
            date: rDate,
            wakeUpOnTime: wakeHabCol !== -1 ? parseBool(habData[k][wakeHabCol]) : false,
            gymWorkout: gymHabCol !== -1 ? parseBool(habData[k][gymHabCol]) : false,
            journaling: journHabCol !== -1 ? parseBool(habData[k][journHabCol]) : false
          });
        }
      }
    }
    
    // 3. Fetch Recent Workout Logs (last 20 rows)
    if (workoutSheet) {
      var wData = workoutSheet.getDataRange().getValues();
      if (wData.length > 1) {
        var wHeaders = wData[0];
        var wDateCol = wHeaders.indexOf("Date");
        var wExeCol = wHeaders.indexOf("Exercise");
        var wSetCol = wHeaders.indexOf("Set Number");
        var wWeightCol = wHeaders.indexOf("Weight (lbs)");
        var wRepsCol = wHeaders.indexOf("Reps");
        var wDurCol = wHeaders.indexOf("Duration (Mins)");
        var wDistCol = wHeaders.indexOf("Distance (km)");
        
        var wStartRow = Math.max(1, wData.length - 20);
        for (var w = wData.length - 1; w >= wStartRow; w--) {
          var wDate = formatDateString(wData[w][wDateCol]);
          if (wDate) {
            response.recentWorkouts.push({
              date: wDate,
              exercise: wExeCol !== -1 ? String(wData[w][wExeCol]).trim() : "",
              setNumber: wSetCol !== -1 ? parseInt(wData[w][wSetCol], 10) || 1 : 1,
              weight: wWeightCol !== -1 ? parseFloat(wData[w][wWeightCol]) || 0.0 : 0.0,
              reps: wRepsCol !== -1 ? parseInt(wData[w][wRepsCol], 10) || 0 : 0,
              duration: wDurCol !== -1 ? parseFloat(wData[w][wDurCol]) || 0.0 : 0.0,
              distance: wDistCol !== -1 ? parseFloat(wData[w][wDistCol]) || 0.0 : 0.0
            });
          }
        }
      }
    }
    
    // 4. Fetch Costco Meal Plan Items
    if (costcoSheet) {
      var cData = costcoSheet.getDataRange().getValues();
      if (cData.length > 1) {
        var cHeaders = cData[0];
        var tripCol = cHeaders.indexOf("Phase/Trip");
        var deptCol = cHeaders.indexOf("Department");
        var nameCol = cHeaders.indexOf("Item Name");
        var sizeCol = cHeaders.indexOf("Target Scale/Size");
        var assignCol = cHeaders.indexOf("Meal Prep Target Assignment");
        
        for (var cIdx = 1; cIdx < cData.length; cIdx++) {
          var name = nameCol !== -1 ? String(cData[cIdx][nameCol]).trim() : "";
          if (name) {
            response.costcoItems.push({
              trip: tripCol !== -1 ? String(cData[cIdx][tripCol]).trim() : "",
              department: deptCol !== -1 ? String(cData[cIdx][deptCol]).trim() : "",
              name: name,
              size: sizeCol !== -1 ? String(cData[cIdx][sizeCol]).trim() : "",
              assignment: assignCol !== -1 ? String(cData[cIdx][assignCol]).trim() : ""
            });
          }
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
    
    if (!params) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Empty request payload" }))
        .setMimeType(ContentService.MimeType.JSON);
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
    if (action === "toggle_habit" || params.habit) {
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
    }
    
    // --- 3. HANDLE LOG WORKOUT SET ---
    if (action === "log_workout") {
      var workoutSheet = ss.getSheetByName("workout_logs");
      if (!workoutSheet) {
        return ContentService.createTextOutput(JSON.stringify({ error: "workout_logs sheet not found" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      var wHeaders = workoutSheet.getDataRange().getValues()[0];
      var wDateCol = wHeaders.indexOf("Date");
      var wSplitCol = wHeaders.indexOf("Split Day");
      var wExeCol = wHeaders.indexOf("Exercise");
      var wSetCol = wHeaders.indexOf("Set Number");
      var wWeightCol = wHeaders.indexOf("Weight (lbs)");
      var wRepsCol = wHeaders.indexOf("Reps");
      var w1rmCol = wHeaders.indexOf("Estimated 1RM");
      var wTimeCol = wHeaders.indexOf("Timestamp");
      var wDurCol = wHeaders.indexOf("Duration (Mins)");
      var wDistCol = wHeaders.indexOf("Distance (km)");
      
      var exercise = String(params.exercise).trim();
      var weight = parseFloat(params.weight) || 0.0;
      var reps = parseInt(params.reps, 10) || 0;
      var duration = parseFloat(params.duration) || 0.0;
      var distance = parseFloat(params.distance) || 0.0;
      
      // Auto-convert distance from miles to km if Treadmill
      if (exercise.toLowerCase().indexOf("treadmill") !== -1 && distance > 0) {
        distance = Math.round(distance * 1.60934 * 100) / 100;
      }
      
      var splitDay = params.splitDay ? String(params.splitDay).trim() : "iOS App";
      
      // Calculate Set Number: count sets today for this exercise + 1
      var wData = workoutSheet.getDataRange().getValues();
      var setNum = 1;
      for (var r = 1; r < wData.length; r++) {
        var rDate = formatDateString(wData[r][wDateCol]);
        var rExe = String(wData[r][wExeCol]).trim();
        if (rDate === activeDateStr && rExe.toLowerCase() === exercise.toLowerCase()) {
          setNum++;
        }
      }
      
      // Calculate Estimated 1RM
      var est1rm = reps > 1 ? Math.round(weight * (1 + (reps / 30.0)) * 10) / 10 : weight;
      
      // Get current timestamp HH:MM:SS
      var timestamp = Utilities.formatDate(now, "America/Toronto", "HH:mm:ss");
      
      // Append row
      var newRow = [];
      for (var c = 0; c < wHeaders.length; c++) {
        if (c === wDateCol) newRow.push(activeDateStr);
        else if (c === wSplitCol) newRow.push(splitDay);
        else if (c === wExeCol) newRow.push(exercise);
        else if (c === wSetCol) newRow.push(setNum);
        else if (c === wWeightCol) newRow.push(weight);
        else if (c === wRepsCol) newRow.push(reps);
        else if (c === w1rmCol) newRow.push(est1rm);
        else if (c === wTimeCol) newRow.push(timestamp);
        else if (c === wDurCol) newRow.push(duration);
        else if (c === wDistCol) newRow.push(distance);
        else newRow.push("");
      }
      
      workoutSheet.appendRow(newRow);
      
      // Auto check off "Gym Workout" habit for today
      var habitsSheet = ss.getSheetByName("Habits");
      if (habitsSheet) {
        var habData = habitsSheet.getDataRange().getValues();
        var habHeaders = habData[0];
        var habDateCol = habHeaders.indexOf("Date");
        var gymHabCol = habHeaders.indexOf("Gym Workout");
        if (habDateCol !== -1 && gymHabCol !== -1) {
          var targetRow = -1;
          for (var j = 1; j < habData.length; j++) {
            var rowDate = formatDateString(habData[j][habDateCol]);
            if (rowDate === activeDateStr) {
              targetRow = j + 1;
              break;
            }
          }
          if (targetRow !== -1) {
            habitsSheet.getRange(targetRow, gymHabCol + 1).setValue(true);
          } else {
            var newHabRow = [];
            for (var c = 0; c < habHeaders.length; c++) {
              if (c === habDateCol) newHabRow.push(activeDateStr);
              else if (c === gymHabCol) newHabRow.push(true);
              else newHabRow.push(false);
            }
            habitsSheet.appendRow(newHabRow);
          }
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify({ success: true, date: activeDateStr, setNumber: setNum }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // --- 4. HANDLE WORKOUT IMPORT FROM HEVY CSV SHARED ON IOS ---
    if (action === "import_hevy_csv") {
      var csvText = params.csvText;
      if (!csvText) {
        return ContentService.createTextOutput(JSON.stringify({ error: "Missing csvText" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      var workoutSheet = ss.getSheetByName("workout_logs");
      if (!workoutSheet) {
        return ContentService.createTextOutput(JSON.stringify({ error: "workout_logs sheet not found" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      // Clean up Windows carriage returns
      var cleanCsv = csvText.replace(/\r/g, "");
      var lines = cleanCsv.split("\n");
      if (lines.length <= 1) {
        return ContentService.createTextOutput(JSON.stringify({ error: "Empty or invalid CSV file" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      // Parse headers using our robust parser
      var headers = parseCSVLine(lines[0]);
      for (var h = 0; h < headers.length; h++) {
        headers[h] = headers[h].toLowerCase();
      }
      
      var dateIdx = -1;
      var workoutNameIdx = -1;
      var exerciseIdx = -1;
      var setIdx = -1;
      var weightIdx = -1;
      var repsIdx = -1;
      var distanceIdx = -1;
      var durationIdx = -1;
      
      for (var h = 0; h < headers.length; h++) {
        var head = headers[h];
        if (head.indexOf("date") !== -1 || head.indexOf("start") !== -1 || head.indexOf("created") !== -1) dateIdx = h;
        if (head.indexOf("set") !== -1 && head.indexOf("type") === -1) setIdx = h;
        if (head.indexOf("weight") !== -1) weightIdx = h;
        if (head.indexOf("rep") !== -1) repsIdx = h;
        if ((head.indexOf("distance") !== -1 || head.indexOf("dist") !== -1) && head.indexOf("unit") === -1) distanceIdx = h;
        if ((head.indexOf("duration") !== -1 || head.indexOf("second") !== -1) && head.indexOf("workout") === -1 && head.indexOf("unit") === -1) durationIdx = h;
        
        // Exclude notes, descriptions, or target from exercise matching
        if (head.indexOf("exercise") !== -1 && head.indexOf("note") === -1 && head.indexOf("desc") === -1 && head.indexOf("target") === -1) {
          if (exerciseIdx === -1 || head.indexOf("name") !== -1 || head.indexOf("title") !== -1 || head === "exercise") {
            exerciseIdx = h;
          }
        }
        
        // Exclude notes, descriptions, or exercise from workout name matching
        if ((head.indexOf("workout") !== -1 || head.indexOf("title") !== -1) && head.indexOf("exercise") === -1 && head.indexOf("note") === -1 && head.indexOf("desc") === -1) {
          workoutNameIdx = h;
        }
      }
      
      if (dateIdx === -1 || exerciseIdx === -1) {
        return ContentService.createTextOutput(JSON.stringify({ error: "Invalid Hevy CSV format: missing Date or Exercise Name header. Found headers: " + headers.join(", ") }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      // Load spreadsheet headers and normalize them
      var wData = workoutSheet.getDataRange().getValues();
      var wHeaders = wData[0];
      var wHeadersClean = [];
      for (var c = 0; c < wHeaders.length; c++) {
        wHeadersClean.push(String(wHeaders[c]).trim().toLowerCase());
      }
      
      var wDateCol = -1;
      var wExeCol = -1;
      var wSetCol = -1;
      var wWeightCol = -1;
      var wRepsCol = -1;
      var w1rmCol = -1;
      var wTimeCol = -1;
      var wSplitCol = -1;
      var wDurCol = -1;
      var wDistCol = -1;
      
      for (var c = 0; c < wHeadersClean.length; c++) {
        var hName = wHeadersClean[c];
        if (hName === "date") wDateCol = c;
        else if (hName.indexOf("exercise") !== -1) wExeCol = c;
        else if (hName.indexOf("set number") !== -1 || hName === "set") wSetCol = c;
        else if (hName.indexOf("weight") !== -1) wWeightCol = c;
        else if (hName === "reps") wRepsCol = c;
        else if (hName.indexOf("1rm") !== -1) w1rmCol = c;
        else if (hName.indexOf("time") !== -1) wTimeCol = c;
        else if (hName.indexOf("split") !== -1) wSplitCol = c;
        else if (hName.indexOf("duration") !== -1) wDurCol = c;
        else if (hName.indexOf("distance") !== -1) wDistCol = c;
      }
      
      // --- DATABASE SELF-HEALING & CLEANUP ENGINE ---
      // We will loop through the existing database, delete corrupted dates, and deduplicate
      var existingKeys = {};
      var rowsToKeep = [];
      
      if (wData.length > 1) {
        for (var r = 1; r < wData.length; r++) {
          var rowVal = wData[r];
          var rawDateVal = wDateCol !== -1 ? rowVal[wDateCol] : "";
          var formattedDateVal = formatDateString(rawDateVal);
          
          var exerciseVal = wExeCol !== -1 ? String(rowVal[wExeCol]).trim() : "";
          var setNumVal = wSetCol !== -1 ? (parseInt(rowVal[wSetCol], 10) || 1) : 1;
          
          // Skip empty dates, dates that contain text (like "Jun" or comma), or empty exercise names (previously corrupted)
          if (!formattedDateVal || String(rawDateVal).indexOf(",") !== -1 || String(rawDateVal).match(/[a-zA-Z]/) || !exerciseVal) {
            continue;
          }
          
          var keyVal = formattedDateVal + "_" + exerciseVal.toLowerCase() + "_" + setNumVal;
          
          if (existingKeys[keyVal]) {
            continue; // Skip duplicate rows
          }
          
          existingKeys[keyVal] = true;
          rowsToKeep.push(rowVal);
        }
      }
      
      // --- NEW WORKOUTS PARSING ---
      var newRowsCount = 0;
      var newRowsToAdd = [];
      var setCounter = {}; // Dynamically count sets sequentially per exercise per date (bypassing non-numeric strings)
      
      for (var i = 1; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        
        var row = parseCSVLine(line);
        if (row.length < Math.max(dateIdx, exerciseIdx)) continue;
        
        var rawDate = row[dateIdx];
        var formattedDate = formatDateString(rawDate);
        if (!formattedDate) continue;
        
        var exercise = row[exerciseIdx];
        
        // Generate set number dynamically (cumcount + 1)
        var setKey = formattedDate + "_" + exercise.toLowerCase();
        if (!setCounter[setKey]) {
          setCounter[setKey] = 1;
        } else {
          setCounter[setKey]++;
        }
        var setNum = setCounter[setKey];
        
        var key = formattedDate + "_" + exercise.toLowerCase() + "_" + setNum;
        if (existingKeys[key]) continue; // Deduplicate
        
        var workoutName = workoutNameIdx !== -1 ? row[workoutNameIdx] : "Hevy App Import";
        
        // Defensive parsing to write empty cell instead of NaN (#NUM!)
        var weightRaw = weightIdx !== -1 ? parseFloat(row[weightIdx]) : NaN;
        var weight = isNaN(weightRaw) ? "" : weightRaw;
        
        var repsRaw = repsIdx !== -1 ? parseInt(row[repsIdx], 10) : NaN;
        var reps = isNaN(repsRaw) ? "" : repsRaw;
        
        var duration = durationIdx !== -1 ? parseDurationToMins(row[durationIdx]) : "";
        var distance = distanceIdx !== -1 ? parseDistanceToKm(row[distanceIdx]) : "";
        
        var est1rm = "";
        if (weight !== "" && reps !== "") {
          est1rm = reps > 1 ? Math.round(weight * (1 + (reps / 30.0)) * 10) / 10 : weight;
        }
        
        // Extract timestamp from rawDate
        var timestamp = "12:00:00";
        var parsedDate = new Date(rawDate.trim());
        if (!isNaN(parsedDate.getTime())) {
          timestamp = Utilities.formatDate(parsedDate, "America/Toronto", "HH:mm:ss");
        }
        
        var newRow = [];
        for (var c = 0; c < wHeaders.length; c++) {
          if (c === wDateCol) newRow.push(formattedDate);
          else if (c === wSplitCol) newRow.push(workoutName);
          else if (c === wExeCol) newRow.push(exercise);
          else if (c === wSetCol) newRow.push(setNum);
          else if (c === wWeightCol) newRow.push(weight);
          else if (c === wRepsCol) newRow.push(reps);
          else if (c === w1rmCol) newRow.push(est1rm);
          else if (c === wTimeCol) newRow.push(timestamp);
          else if (c === wDurCol) newRow.push(duration);
          else if (c === wDistCol) newRow.push(distance);
          else newRow.push("");
        }
        
        newRowsToAdd.push(newRow);
        rowsToKeep.push(newRow);
        existingKeys[key] = true;
        newRowsCount++;
      }
      
      // Clear entire sheet below headers
      if (wData.length > 1) {
        workoutSheet.getRange(2, 1, wData.length, wHeaders.length).clearContent();
      }
      
      // Sort database rowsToKeep chronologically
      if (rowsToKeep.length > 0) {
        rowsToKeep.sort(function(a, b) {
          var dateStrA = formatDateString(a[wDateCol]);
          var dateStrB = formatDateString(b[wDateCol]);
          if (dateStrA !== dateStrB) {
            return dateStrA < dateStrB ? -1 : 1;
          }
          var exeA = String(a[wExeCol]).toLowerCase();
          var exeB = String(b[wExeCol]).toLowerCase();
          if (exeA !== exeB) {
            return exeA < exeB ? -1 : 1;
          }
          return (parseInt(a[wSetCol], 10) || 0) - (parseInt(b[wSetCol], 10) || 0);
        });
        
        // Write back clean, sorted, deduplicated, and newly added rows
        workoutSheet.getRange(2, 1, rowsToKeep.length, wHeaders.length).setValues(rowsToKeep);
      }
      
      return ContentService.createTextOutput(JSON.stringify({ success: true, importedSets: newRowsCount }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ error: "Invalid action or parameters." }))
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
  var str = String(val).trim();
  // If already yyyy-MM-dd, return as-is to avoid timezone shifts
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  var parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, "America/Toronto", "yyyy-MM-dd");
  }
  return str.split("T")[0].trim();
}

function parseBool(val) {
  if (typeof val === "boolean") return val;
  var str = String(val).toLowerCase().trim();
  return str === "true" || str === "1";
}

function parseCSVLine(line) {
  var result = [];
  var current = "";
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var char = line.charAt(i);
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseDurationToMins(val) {
  if (!val) return "";
  var valStr = String(val).trim().toLowerCase();
  if (valStr === "" || valStr === "nan") return "";
  
  // Handle colon format (HH:MM:SS or MM:SS)
  if (valStr.indexOf(":") !== -1) {
    var parts = valStr.split(":");
    try {
      if (parts.length === 3) {
        var h = parseInt(parts[0], 10) || 0;
        var m = parseInt(parts[1], 10) || 0;
        var s = parseFloat(parts[2]) || 0;
        return Math.round((h * 60.0 + m + s / 60.0) * 10) / 10;
      } else if (parts.length === 2) {
        var m = parseInt(parts[0], 10) || 0;
        var s = parseFloat(parts[1]) || 0;
        return Math.round((m + s / 60.0) * 10) / 10;
      }
    } catch (err) {
      // fallback
    }
  }
  
  var num = parseFloat(valStr);
  if (isNaN(num)) return "";
  
  // If it is seconds (typically > 300), convert to minutes
  if (num > 300) {
    return Math.round((num / 60.0) * 10) / 10;
  }
  return num;
}

function parseDistanceToKm(val) {
  if (!val) return "";
  var valStr = String(val).trim().toLowerCase();
  if (valStr === "" || valStr === "nan") return "";
  
  // Extract number
  var match = valStr.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (match) {
    var num = parseFloat(match[1]);
    if (isNaN(num)) return "";
    
    // If it contains "km" or "kilometer", it is already in km
    if (valStr.indexOf("km") !== -1 || valStr.indexOf("kilometer") !== -1) {
      return Math.round(num * 100) / 100;
    }
    // If it contains "m" but not "k", it is in meters (convert to km)
    if (valStr.indexOf("m") !== -1 && valStr.indexOf("k") === -1) {
      return Math.round((num / 1000.0) * 100) / 100;
    }
    // If the number is large (> 50), it is likely meters
    if (num > 50) {
      return Math.round((num / 1000.0) * 100) / 100;
    }
    // Otherwise, assume miles and convert to km
    return Math.round(num * 1.60934 * 100) / 100;
  }
  return "";
}
