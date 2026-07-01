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
    sheet.appendRow(["Date", "HRV", "Sleep Duration", "RHR", "Steps", "Bodyweight", "Wake Time", "Sleep Time"]);
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
  
  var sleepTimeColIdx = headers.indexOf("Sleep Time");
  if (sleepTimeColIdx === -1) {
    sheet.getRange(1, headers.length + 1).setValue("Sleep Time");
    headers.push("Sleep Time");
    sleepTimeColIdx = headers.indexOf("Sleep Time");
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
      biometrics: { steps: 0, sleep: 0.0, hrv: 0, rhr: 0, weight: 170.0, wakeTime: "No data", sleepTime: "No data" },
      biometricsHistory: [],
      habits: { wakeUpOnTime: false, gymWorkout: false, journaling: false },
      habitHistory: [],
      recentWorkouts: [],
      costcoItems: []
    };
    
    // 1. Fetch Today's Biometrics & History
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
      var sleepTimeCol = hHeaders.indexOf("Sleep Time");
      
      for (var i = hData.length - 1; i > 0; i--) {
        var rowDate = formatDateString(hData[i][hDateCol]);
        if (rowDate === activeDateStr) {
          if (stepsCol !== -1) response.biometrics.steps = parseInt(hData[i][stepsCol], 10) || 0;
          if (sleepCol !== -1) response.biometrics.sleep = parseSleepDurationHours(hData[i][sleepCol]);
          if (hrvCol !== -1) response.biometrics.hrv = parseInt(hData[i][hrvCol], 10) || 0;
          if (rhrCol !== -1) response.biometrics.rhr = parseInt(hData[i][rhrCol], 10) || 0;
          if (weightCol !== -1) response.biometrics.weight = parseFloat(hData[i][weightCol]) || 170.0;
          if (wakeCol !== -1) response.biometrics.wakeTime = formatTimeValue(hData[i][wakeCol]) || "No data";
          if (sleepTimeCol !== -1) response.biometrics.sleepTime = formatTimeValue(hData[i][sleepTimeCol]) || "No data";
          break;
        }
      }
      
      // Populate biometrics history (last 30 rows)
      if (hData.length > 1) {
        var startHRow = Math.max(1, hData.length - 30);
        for (var h = hData.length - 1; h >= startHRow; h--) {
          var hDate = formatDateString(hData[h][hDateCol]);
          if (hDate) {
            response.biometricsHistory.push({
              date: hDate,
              steps: stepsCol !== -1 ? parseInt(hData[h][stepsCol], 10) || 0 : 0,
              sleep: sleepCol !== -1 ? parseSleepDurationHours(hData[h][sleepCol]) : 0.0,
              hrv: hrvCol !== -1 ? parseInt(hData[h][hrvCol], 10) || 0 : 0,
              rhr: rhrCol !== -1 ? parseInt(hData[h][rhrCol], 10) || 0 : 0,
              weight: weightCol !== -1 ? parseFloat(hData[h][weightCol]) || 0.0 : 0.0,
              wakeTime: wakeCol !== -1 ? formatTimeValue(hData[h][wakeCol]) : "",
              sleepTime: sleepTimeCol !== -1 ? formatTimeValue(hData[h][sleepTimeCol]) : ""
            });
          }
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
        
        var wStartRow = 1;
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
    
    // 5. Fetch Mission Control / Master Task Tracker Items
    response.missionControlItems = [];
    var missionSheet = ss.getSheetByName("Master Task Tracker");
    if (missionSheet) {
      var mData = missionSheet.getDataRange().getValues();
      if (mData.length > 1) {
        var mHeaders = mData[0];
        var mStatusCol = mHeaders.indexOf("Status");
        var mSchedCol = mHeaders.indexOf("Scheduled?");
        var mTypeCol = mHeaders.indexOf("Type");
        var mCalCol = mHeaders.indexOf("Calendar");
        var mDateCol = mHeaders.indexOf("Date");
        var mTimeCol = mHeaders.indexOf("Time");
        var mDurCol = mHeaders.indexOf("Duration (Mins)");
        var mLocationCol = mHeaders.indexOf("Location");
        var mNotesCol = mHeaders.indexOf("Notes");
        var mEventIdCol = mHeaders.indexOf("Event ID");
        var mTimeblockIdCol = mHeaders.indexOf("Timeblock ID");
        var mItemNameCol = mHeaders.indexOf("Item Name");
        
        var mStartRow = Math.max(1, mData.length - 100);
        for (var m = mData.length - 1; m >= mStartRow; m--) {
          var itemDate = formatDateString(mData[m][mDateCol]);
          if (itemDate) {
            var timeRaw = mTimeCol !== -1 ? mData[m][mTimeCol] : "";
            var timeFormatted = "";
            if (timeRaw) {
              if (timeRaw instanceof Date) {
                timeFormatted = Utilities.formatDate(timeRaw, "America/Toronto", "HH:mm:ss");
              } else {
                var rawStr = String(timeRaw).trim();
                var match = rawStr.match(/(\d{2}:\d{2}:\d{2})/);
                timeFormatted = match ? match[1] : rawStr;
              }
            }
            
            response.missionControlItems.push({
              id: mEventIdCol !== -1 && mData[m][mEventIdCol] ? String(mData[m][mEventIdCol]).trim() : "row_" + m,
              status: mStatusCol !== -1 ? parseBool(mData[m][mStatusCol]) : false,
              scheduled: mSchedCol !== -1 ? parseBool(mData[m][mSchedCol]) : false,
              type: mTypeCol !== -1 ? String(mData[m][mTypeCol]).trim() : "",
              calendar: mCalCol !== -1 ? String(mData[m][mCalCol]).trim() : "",
              date: itemDate,
              time: timeFormatted,
              duration: mDurCol !== -1 ? parseInt(mData[m][mDurCol], 10) || 0 : 0,
              location: mLocationCol !== -1 ? String(mData[m][mLocationCol]).trim() : "",
              notes: mNotesCol !== -1 ? String(mData[m][mNotesCol]).trim() : "",
              eventId: mEventIdCol !== -1 ? String(mData[m][mEventIdCol]).trim() : "",
              timeblockId: mTimeblockIdCol !== -1 ? String(mData[m][mTimeblockIdCol]).trim() : "",
              itemName: mItemNameCol !== -1 ? String(mData[m][mItemNameCol]).trim() : ""
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
    logDebugRequest(action, params);
    
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
        healthSheet.appendRow(["Date", "HRV", "Sleep Duration", "RHR", "Steps", "Bodyweight", "Wake Time", "Sleep Time"]);
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
      var sleepTimeCol = hHeaders.indexOf("Sleep Time");
      
      // Find row for today
      var targetRow = -1;
      for (var i = 1; i < hData.length; i++) {
        var rowDate = formatDateString(hData[i][hDateCol]);
        if (rowDate === activeDateStr) {
          targetRow = i + 1;
          break;
        }
      }
      
      var stepsVal = getParam(params, ["steps"]);
      var steps = stepsVal !== undefined && stepsVal !== null ? parseInt(stepsVal, 10) : null;
      
      var sleepVal = getParam(params, ["sleep", "sleepDuration"]);
      var sleep = sleepVal !== undefined && sleepVal !== null ? parseFloat(sleepVal) : null;
      var sleepStr = null;
      if (sleep !== null) {
        if (sleep > 24) {
          sleep = sleep / 3600.0; // Convert seconds to hours
        }
        var hours = Math.floor(sleep);
        var minutes = Math.round((sleep - hours) * 60);
        if (minutes === 60) {
          hours += 1;
          minutes = 0;
        }
        sleepStr = hours + "h " + minutes + "m";
      }
      
      var hrvVal = getParam(params, ["hrv"]);
      var hrv = hrvVal !== undefined && hrvVal !== null ? parseInt(hrvVal, 10) : null;
      
      var rhrVal = getParam(params, ["rhr"]);
      var rhr = rhrVal !== undefined && rhrVal !== null ? parseInt(rhrVal, 10) : null;
      
      var weightVal = getParam(params, ["weight", "bodyweight"]);
      var weight = weightVal !== undefined && weightVal !== null ? parseFloat(weightVal) : null;
      
      var wakeTimeVal = getParam(params, ["wakeTime", "wake_time", "wake", "wakeUpTime", "wake_up_time"]);
      var wakeTime = wakeTimeVal !== undefined && wakeTimeVal !== null ? String(wakeTimeVal).trim() : null;
      
      var sleepTimeVal = getParam(params, ["sleepTime", "sleep_time", "sleep_start", "sleepstart"]);
      var sleepTime = sleepTimeVal !== undefined && sleepTimeVal !== null ? String(sleepTimeVal).trim() : null;
      
      if (targetRow !== -1) {
        if (steps !== null && stepsCol !== -1) healthSheet.getRange(targetRow, stepsCol + 1).setValue(steps);
        if (sleepStr !== null && sleepCol !== -1) healthSheet.getRange(targetRow, sleepCol + 1).setValue(sleepStr);
        if (hrv !== null && hrvCol !== -1) healthSheet.getRange(targetRow, hrvCol + 1).setValue(hrv);
        if (rhr !== null && rhrCol !== -1) healthSheet.getRange(targetRow, rhrCol + 1).setValue(rhr);
        if (weight !== null && weightCol !== -1) healthSheet.getRange(targetRow, weightCol + 1).setValue(weight);
        if (wakeTime !== null && wakeCol !== -1) healthSheet.getRange(targetRow, wakeCol + 1).setValue(wakeTime);
        if (sleepTime !== null && sleepTimeCol !== -1) healthSheet.getRange(targetRow, sleepTimeCol + 1).setValue(sleepTime);
      } else {
        var newRow = [];
        for (var c = 0; c < hHeaders.length; c++) {
          if (c === hDateCol) newRow.push(activeDateStr);
          else if (c === stepsCol && steps !== null) newRow.push(steps);
          else if (c === sleepCol && sleepStr !== null) newRow.push(sleepStr);
          else if (c === hrvCol && hrv !== null) newRow.push(hrv);
          else if (c === rhrCol && rhr !== null) newRow.push(rhr);
          else if (c === weightCol && weight !== null) newRow.push(weight);
          else if (c === wakeCol && wakeTime !== null) newRow.push(wakeTime);
          else if (c === sleepTimeCol && sleepTime !== null) newRow.push(sleepTime);
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
      var workoutDurIdx = -1;
      var startTimeIdx = -1;
      var endTimeIdx = -1;
      
      for (var h = 0; h < headers.length; h++) {
        var head = headers[h];
        if (head.indexOf("date") !== -1 || head.indexOf("start") !== -1 || head.indexOf("created") !== -1) dateIdx = h;
        if (head.indexOf("set") !== -1 && head.indexOf("type") === -1) setIdx = h;
        if (head.indexOf("weight") !== -1) weightIdx = h;
        if (head.indexOf("rep") !== -1) repsIdx = h;
        if ((head.indexOf("distance") !== -1 || head.indexOf("dist") !== -1) && head.indexOf("unit") === -1) distanceIdx = h;
        if ((head.indexOf("duration") !== -1 || head.indexOf("second") !== -1) && head.indexOf("workout") === -1 && head.indexOf("unit") === -1) durationIdx = h;
        if (head.indexOf("workout duration") !== -1 || head.indexOf("workout_duration") !== -1) workoutDurIdx = h;
        if (head.indexOf("start_time") !== -1 || head.indexOf("start time") !== -1) startTimeIdx = h;
        if (head.indexOf("end_time") !== -1 || head.indexOf("end time") !== -1) endTimeIdx = h;
        
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
      var wGymDurCol = -1;
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
        else if (hName === "duration (mins)") wDurCol = c;
        else if (hName === "gym duration (mins)") wGymDurCol = c;
        else if (hName.indexOf("distance") !== -1) wDistCol = c;
      }
      
      // --- DATABASE SELF-HEALING & CLEANUP ENGINE ---
      // We will loop through the existing database, delete corrupted dates, and deduplicate
      var existingKeyToIndex = {};
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
          
          if (existingKeyToIndex[keyVal] !== undefined) {
            continue; // Skip duplicate rows
          }
          
          existingKeyToIndex[keyVal] = rowsToKeep.length;
          rowsToKeep.push(rowVal);
        }
      }
      
      // --- NEW WORKOUTS PARSING & MERGE ---
      var newRowsCount = 0;
      var updatedRowsCount = 0;
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
        
        // Use set-specific duration (seconds) if available in Hevy CSV for cardio pace calculations
        var rawSecs = durationIdx !== -1 ? row[durationIdx] : "";
        var cardioDur = parseDurationToMins(rawSecs);
        
        // Calculate overall gym duration
        var gymDur = "";
        if (workoutDurIdx !== -1) {
          gymDur = parseDurationToMins(row[workoutDurIdx]);
        }
        // Fallback to start/end times if gym duration is empty/0
        if ((gymDur === "" || gymDur === "0:00") && startTimeIdx !== -1 && endTimeIdx !== -1 && row[startTimeIdx] && row[endTimeIdx]) {
          var startD = new Date(row[startTimeIdx].trim());
          var endD = new Date(row[endTimeIdx].trim());
          if (!isNaN(startD.getTime()) && !isNaN(endD.getTime())) {
            var diffMins = Math.round((endD.getTime() - startD.getTime()) / 60000);
            if (diffMins > 0) {
              gymDur = parseDurationToMins(diffMins * 60);
            }
          }
        }
        // Fallback to cardio duration
        if ((gymDur === "" || gymDur === "0:00") && cardioDur !== "" && cardioDur !== "0:00") {
          gymDur = cardioDur;
        }
        
        var distance = distanceIdx !== -1 ? parseDistanceToKm(row[distanceIdx]) : "";
        var key = formattedDate + "_" + exercise.toLowerCase() + "_" + setNum;
        
        if (existingKeyToIndex[key] !== undefined) {
          // Merge CSV details into existing matches
          var existingRow = rowsToKeep[existingKeyToIndex[key]];
          var rowUpdated = false;
          
          if (wDistCol !== -1 && (existingRow[wDistCol] === "" || parseFloat(existingRow[wDistCol]) === 0) && distance !== "" && parseFloat(distance) > 0) {
            existingRow[wDistCol] = distance;
            rowUpdated = true;
          }
          if (wDurCol !== -1 && (existingRow[wDurCol] === "" || existingRow[wDurCol] === "0:00") && cardioDur !== "" && cardioDur !== "0:00") {
            existingRow[wDurCol] = cardioDur;
            rowUpdated = true;
          }
          if (wGymDurCol !== -1 && (existingRow[wGymDurCol] === "" || existingRow[wGymDurCol] === "0:00") && gymDur !== "" && gymDur !== "0:00") {
            existingRow[wGymDurCol] = gymDur;
            rowUpdated = true;
          }
          if (rowUpdated) {
            updatedRowsCount++;
          }
          continue; // Skip appending as a new row
        }
        
        var workoutName = workoutNameIdx !== -1 ? row[workoutNameIdx] : "Hevy App Import";
        
        // Defensive parsing to write empty cell instead of NaN (#NUM!)
        var weightRaw = weightIdx !== -1 ? parseFloat(row[weightIdx]) : NaN;
        var weight = isNaN(weightRaw) ? "" : weightRaw;
        
        var repsRaw = repsIdx !== -1 ? parseInt(row[repsIdx], 10) : NaN;
        var reps = isNaN(repsRaw) ? "" : repsRaw;
        
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
          else if (c === wDurCol) newRow.push(cardioDur);
          else if (c === wGymDurCol) newRow.push(gymDur);
          else if (c === wDistCol) newRow.push(distance);
          else newRow.push("");
        }
        
        newRowsToAdd.push(newRow);
        rowsToKeep.push(newRow);
        existingKeyToIndex[key] = rowsToKeep.length - 1;
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
    
    // --- 5. LOG NEW MISSION CONTROL ITEM ---
    if (action === "log_mission_item") {
      var calendarIdMap = {
        "Kevin Nguyen": "24ktkn@gmail.com",
        "Family": "family05668227215423587251@group.calendar.google.com",
        "School": "0dbc1f40c9dc993c6b893fa0e1646b888eb8ed8599668c9697d72689e041e315@group.calendar.google.com",
        "Volunteering": "57bb8a8bf61e233e8bb76ab03f53b03ead35e7ba66e37d2bfd73792e1c1e575e@group.calendar.google.com"
      };
      
      var eventId = "";
      var timeblockId = "";
      
      if (params.type === "Event" || params.type === "Task") {
        try {
          var calId = calendarIdMap[params.calendar] || "24ktkn@gmail.com";
          var cal = CalendarApp.getCalendarById(calId);
          if (cal) {
            var title = params.type === "Task" ? "☑️ [Task] " + params.itemName : params.itemName;
            var notesStr = params.notes || "";
            var locStr = params.location || "";
            
            var dateParts = params.date.split("-");
            var year = parseInt(dateParts[0], 10);
            var month = parseInt(dateParts[1], 10) - 1;
            var day = parseInt(dateParts[2], 10);
            
            if (!params.time || params.time === "00:00:00" || params.time === "") {
              var startD = new Date(year, month, day);
              var ev = cal.createAllDayEvent(title, startD, {description: notesStr, location: locStr});
              if (params.type === "Event") {
                eventId = ev.getId();
              } else {
                timeblockId = ev.getId();
              }
            } else {
              var timeParts = params.time.split(":");
              var hh = parseInt(timeParts[0], 10);
              var mm = parseInt(timeParts[1], 10);
              var ss = parseInt(timeParts[2], 10) || 0;
              
              var startD = new Date(year, month, day, hh, mm, ss);
              var endD = new Date(startD.getTime() + (params.duration || 60) * 60 * 1000);
              
              var ev = cal.createEvent(title, startD, endD, {description: notesStr, location: locStr});
              if (params.type === "Event") {
                eventId = ev.getId();
              } else {
                timeblockId = ev.getId();
              }
            }
          }
        } catch (calErr) {
          Logger.log("Calendar error: " + calErr.message);
        }
      }
      
      if (params.type === "Task") {
        try {
          var tasklistMap = {
            "Kevin Nguyen": "@default", 
            "Family": "Um85a3gwMVZqTXN4X0M3Wg",        
            "School": "ZGRiT21qM2ZCbVRWOVBlMQ",        
            "Volunteering": "bUtfd3ZxU0Y3RFUyM2x2dQ"
          };
          var tlId = tasklistMap[params.calendar] || "@default";
          if (typeof Tasks !== 'undefined') {
            var taskBody = {
              title: params.itemName,
              notes: params.notes || "",
              due: params.date + "T00:00:00.000Z"
            };
            var t = Tasks.Tasks.insert(taskBody, tlId);
            eventId = t.id;
          } else {
            eventId = "task_" + Utilities.getUuid();
          }
        } catch (taskErr) {
          Logger.log("Tasks error: " + taskErr.message);
          eventId = "task_" + Utilities.getUuid();
        }
      }
      
      var missionSheet = ss.getSheetByName("Master Task Tracker");
      if (missionSheet) {
        var mHeaders = missionSheet.getDataRange().getValues()[0];
        var mStatusCol = mHeaders.indexOf("Status");
        var mSchedCol = mHeaders.indexOf("Scheduled?");
        var mTypeCol = mHeaders.indexOf("Type");
        var mCalCol = mHeaders.indexOf("Calendar");
        var mDateCol = mHeaders.indexOf("Date");
        var mTimeCol = mHeaders.indexOf("Time");
        var mDurCol = mHeaders.indexOf("Duration (Mins)");
        var mLocationCol = mHeaders.indexOf("Location");
        var mNotesCol = mHeaders.indexOf("Notes");
        var mEventIdCol = mHeaders.indexOf("Event ID");
        var mTimeblockIdCol = mHeaders.indexOf("Timeblock ID");
        var mItemNameCol = mHeaders.indexOf("Item Name");
        
        var isScheduled = (params.time && params.time !== "" && params.time !== "00:00:00");
        
        var newRow = [];
        for (var c = 0; c < mHeaders.length; c++) {
          if (c === mStatusCol) newRow.push(false);
          else if (c === mSchedCol) newRow.push(isScheduled);
          else if (c === mTypeCol) newRow.push(params.type);
          else if (c === mCalCol) newRow.push(params.calendar);
          else if (c === mDateCol) newRow.push(params.date);
          else if (c === mTimeCol) newRow.push(params.time || "");
          else if (c === mDurCol) newRow.push(params.duration || 0);
          else if (c === mLocationCol) newRow.push(params.location || "");
          else if (c === mNotesCol) newRow.push(params.notes || "");
          else if (c === mEventIdCol) newRow.push(eventId);
          else if (c === mTimeblockIdCol) newRow.push(timeblockId);
          else if (c === mItemNameCol) newRow.push(params.itemName);
          else newRow.push("");
        }
        missionSheet.appendRow(newRow);
      }
      
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // --- 6. TOGGLE MISSION CONTROL ITEM ---
    if (action === "toggle_mission_item") {
      var missionSheet = ss.getSheetByName("Master Task Tracker");
      var eventId = params.eventId;
      var completed = params.completed;
      
      if (missionSheet && eventId) {
        var mData = missionSheet.getDataRange().getValues();
        var mHeaders = mData[0];
        var mEventIdCol = mHeaders.indexOf("Event ID");
        var mStatusCol = mHeaders.indexOf("Status");
        var mTypeCol = mHeaders.indexOf("Type");
        var mCalCol = mHeaders.indexOf("Calendar");
        
        for (var i = 1; i < mData.length; i++) {
          if (String(mData[i][mEventIdCol]).trim() === eventId) {
            missionSheet.getRange(i + 1, mStatusCol + 1).setValue(completed);
            
            var itemType = String(mData[i][mTypeCol]).trim();
            var calName = String(mData[i][mCalCol]).trim();
            if (itemType === "Task" && typeof Tasks !== 'undefined') {
              try {
                var tasklistMap = {
                  "Kevin Nguyen": "@default", 
                  "Family": "Um85a3gwMVZqTXN4X0M3Wg",        
                  "School": "ZGRiT21qM2ZCbVRWOVBlMQ",        
                  "Volunteering": "bUtfd3ZxU0Y3RFUyM2x2dQ"
                };
                var tlId = tasklistMap[calName] || "@default";
                Tasks.Tasks.patch({ status: completed ? 'completed' : 'needsAction' }, tlId, eventId);
              } catch (e) {}
            }
            break;
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // --- 7. DELETE MISSION CONTROL ITEM ---
    if (action === "delete_mission_item") {
      var missionSheet = ss.getSheetByName("Master Task Tracker");
      var eventId = params.eventId;
      
      if (missionSheet && eventId) {
        var mData = missionSheet.getDataRange().getValues();
        var mHeaders = mData[0];
        var mEventIdCol = mHeaders.indexOf("Event ID");
        var mTimeblockIdCol = mHeaders.indexOf("Timeblock ID");
        var mTypeCol = mHeaders.indexOf("Type");
        var mCalCol = mHeaders.indexOf("Calendar");
        
        var calendarIdMap = {
          "Kevin Nguyen": "24ktkn@gmail.com",
          "Family": "family05668227215423587251@group.calendar.google.com",
          "School": "0dbc1f40c9dc993c6b893fa0e1646b888eb8ed8599668c9697d72689e041e315@group.calendar.google.com",
          "Volunteering": "57bb8a8bf61e233e8bb76ab03f53b03ead35e7ba66e37d2bfd73792e1c1e575e@group.calendar.google.com"
        };
        
        for (var i = 1; i < mData.length; i++) {
          if (String(mData[i][mEventIdCol]).trim() === eventId) {
            var itemType = String(mData[i][mTypeCol]).trim();
            var calName = String(mData[i][mCalCol]).trim();
            var timeblockId = String(mData[i][mTimeblockIdCol]).trim();
            
            try {
              var calId = calendarIdMap[calName] || "24ktkn@gmail.com";
              var cal = CalendarApp.getCalendarById(calId);
              if (cal) {
                if (itemType === "Event" && eventId) {
                  var ev = cal.getEventById(eventId);
                  if (ev) ev.deleteEvent();
                } else if (itemType === "Task" && timeblockId) {
                  var ev = cal.getEventById(timeblockId);
                  if (ev) ev.deleteEvent();
                }
              }
            } catch (e) {}
            
            if (itemType === "Task" && typeof Tasks !== 'undefined' && eventId) {
              try {
                var tasklistMap = {
                  "Kevin Nguyen": "@default", 
                  "Family": "Um85a3gwMVZqTXN4X0M3Wg",        
                  "School": "ZGRiT21qM2ZCbVRWOVBlMQ",        
                  "Volunteering": "bUtfd3ZxU0Y3RFUyM2x2dQ"
                };
                var tlId = tasklistMap[calName] || "@default";
                Tasks.Tasks.remove(tlId, eventId);
              } catch (e) {}
            }
            
            missionSheet.deleteRow(i + 1);
            break;
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
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

function parseSleepDurationHours(val) {
  if (!val) return 0.0;
  var str = String(val).toLowerCase().trim();
  if (str.indexOf("h") !== -1 || str.indexOf("m") !== -1) {
    var hours = 0.0;
    var minutes = 0.0;
    if (str.indexOf("h") !== -1) {
      var parts = str.split("h");
      hours = parseFloat(parts[0]) || 0.0;
      str = parts[1];
    }
    if (str.indexOf("m") !== -1) {
      var parts = str.split("m");
      minutes = parseFloat(parts[0]) || 0.0;
    }
    return hours + (minutes / 60.0);
  }
  return parseFloat(val) || 0.0;
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
  
  // If it's already in colon format (HH:MM:SS or MM:SS), return it as-is
  if (valStr.indexOf(":") !== -1) {
    return valStr;
  }
  
  var num = parseFloat(valStr);
  if (isNaN(num)) return "";
  
  // Convert raw seconds to MM:SS or HH:MM:SS duration string
  var h = Math.floor(num / 3600);
  var m = Math.floor((num % 3600) / 60);
  var s = Math.round(num % 60);
  
  var sStr = s < 10 ? "0" + s : String(s);
  if (h > 0) {
    var mStr = m < 10 ? "0" + m : String(m);
    return h + ":" + mStr + ":" + sStr;
  } else {
    return m + ":" + sStr;
  }
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

function getParam(params, keys) {
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (params[key] !== undefined) return params[key];
    var cleanKey = key.toLowerCase().replace(/_/g, "").replace(/\s/g, "");
    for (var p in params) {
      var cleanP = p.toLowerCase().replace(/_/g, "").replace(/\s/g, "");
      if (cleanP === cleanKey) return params[p];
    }
  }
  return undefined;
}

function logDebugRequest(action, params) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var debugSheet = ss.getSheetByName("debug_logs");
    if (!debugSheet) {
      debugSheet = ss.insertSheet("debug_logs");
      debugSheet.appendRow(["Timestamp", "Action", "Parameters JSON"]);
    }
    debugSheet.appendRow([new Date(), action, JSON.stringify(params)]);
  } catch (e) {}
}

function formatTimeValue(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, "America/Toronto", "h:mm a");
  }
  var str = String(val).trim();
  if (str === "" || str.toLowerCase() === "no data") return "";
  
  // If it's a serialized Date string, try parsing it
  if (str.indexOf("1899") !== -1 || str.indexOf("GMT") !== -1) {
    try {
      var d = new Date(str);
      if (!isNaN(d.getTime())) {
        return Utilities.formatDate(d, "America/Toronto", "h:mm a");
      }
    } catch(e) {}
  }
  
  return str;
}


