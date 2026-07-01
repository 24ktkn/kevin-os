import SwiftUI
import WebKit

struct ContentView: View {
    @StateObject private var networkManager = NetworkManager()
    @State private var selectedTab = 0
    @State private var showingImportAlert = false
    @State private var importAlertTitle = ""
    @State private var importAlertMessage = ""
    
    // Core color palette matching premium web app
    let bgColor = Color(red: 0.06, green: 0.06, blue: 0.07) // #0F0F12
    let cardBgColor = Color(red: 0.09, green: 0.09, blue: 0.11) // #16161D
    let cardBorderColor = Color(red: 0.14, green: 0.14, blue: 0.18) // #23232F
    let neonGreen = Color(red: 0.0, green: 1.0, blue: 0.4) // #00FF66
    let cyanColor = Color(red: 0.0, green: 0.94, blue: 1.0) // #00F0FF
    let yellowColor = Color(red: 1.0, green: 0.72, blue: 0.01) // #FFB703
    let redColor = Color(red: 1.0, green: 0.2, blue: 0.2) // #FF3333
    let lavenderColor = Color(red: 0.66, green: 0.33, blue: 0.97) // #A855F7
    
    init() {
        // Dark theme TabBar custom styling
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.11, alpha: 1.0)
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
        UITabBar.appearance().unselectedItemTintColor = UIColor.gray
    }
    
    var body: some View {
        TabView(selection: $selectedTab) {
            
            // --- TAB 1: CENTRAL OS HUB ---
            OSHubView(networkManager: networkManager, bgColor: bgColor, cardBgColor: cardBgColor, cardBorderColor: cardBorderColor, neonGreen: neonGreen, cyanColor: cyanColor, yellowColor: yellowColor, redColor: redColor, lavenderColor: lavenderColor)
                .tabItem {
                    Image(systemName: "gauge")
                    Text("OS Hub")
                }
                .tag(0)
            
            // --- TAB 2: WORKOUT WEBVIEW ---
            WorkoutWebView(networkManager: networkManager, bgColor: bgColor, cardBgColor: cardBgColor, cardBorderColor: cardBorderColor, neonGreen: neonGreen, cyanColor: cyanColor, yellowColor: yellowColor, redColor: redColor, lavenderColor: lavenderColor)
                .tabItem {
                    Image(systemName: "dumbbell.fill")
                    Text("Workouts")
                }
                .tag(1)
            
            // --- TAB 3: HABITS CHECKLIST ---
            HabitsHistoryView(networkManager: networkManager, bgColor: bgColor, cardBgColor: cardBgColor, cardBorderColor: cardBorderColor, neonGreen: neonGreen, cyanColor: cyanColor, lavenderColor: lavenderColor)
                .tabItem {
                    Image(systemName: "bolt.fill")
                    Text("Habits")
                }
                .tag(2)
            
            // --- TAB 4: MEAL PREP & COSTCO ---
            MealPrepView(networkManager: networkManager, bgColor: bgColor, cardBgColor: cardBgColor, cardBorderColor: cardBorderColor, yellowColor: yellowColor, cyanColor: cyanColor, neonGreen: neonGreen)
                .tabItem {
                    Image(systemName: "basket.fill")
                    Text("Meal Prep")
                }
                .tag(3)
            
            // --- TAB 5: MISSION CONTROL ---
            MissionControlView(networkManager: networkManager, bgColor: bgColor, cardBgColor: cardBgColor, cardBorderColor: cardBorderColor, neonGreen: neonGreen, cyanColor: cyanColor, yellowColor: yellowColor, redColor: redColor, lavenderColor: lavenderColor)
                .tabItem {
                    Image(systemName: "calendar")
                    Text("Mission")
                }
                .tag(4)
        }
        .accentColor(neonGreen)
        .onAppear {
            networkManager.fetchData()
        }
        .onOpenURL { url in
            // Accessing security-scoped resource is optional depending on the origin of the URL.
            // We start accessing it, but we fallback to reading directly if it's not security-scoped.
            let isSecurityScoped = url.startAccessingSecurityScopedResource()
            defer {
                if isSecurityScoped {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            
            do {
                let csvData = try Data(contentsOf: url)
                if let csvText = String(data: csvData, encoding: .utf8) {
                    networkManager.importHevyCSV(csvText: csvText) { success, count, errorMsg in
                        DispatchQueue.main.async {
                            if success {
                                self.importAlertTitle = "Hevy CSV Imported"
                                self.importAlertMessage = "Success! Discovered and added \(count) new workout sets to your Google Sheet without any duplicates."
                                self.showingImportAlert = true
                            } else {
                                self.importAlertTitle = "Import Failed"
                                self.importAlertMessage = errorMsg
                                self.showingImportAlert = true
                            }
                        }
                    }
                } else {
                    print("Failed to convert shared CSV data to String")
                    DispatchQueue.main.async {
                        self.importAlertTitle = "Import Failed"
                        self.importAlertMessage = "Could not decode CSV data as UTF-8 string."
                        self.showingImportAlert = true
                    }
                }
            } catch {
                print("Failed to read shared CSV file: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    self.importAlertTitle = "Import Failed"
                    self.importAlertMessage = "Failed to access file: \(error.localizedDescription)"
                    self.showingImportAlert = true
                }
            }
        }
        .alert(isPresented: $showingImportAlert) {
            Alert(
                title: Text(importAlertTitle),
                message: Text(importAlertMessage),
                dismissButton: .default(Text("OK"))
            )
        }
    }
}

// =========================================================================
// 🛰️ VIEW 1: CENTRAL OS HUB
// =========================================================================
struct OSHubView: View {
    @ObservedObject var networkManager: NetworkManager
    let bgColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    let neonGreen: Color
    let cyanColor: Color
    let yellowColor: Color
    let redColor: Color
    let lavenderColor: Color
    
    // Isolated computed properties to speed up Swift compiler type-checking
    var hrvString: String {
        networkManager.biometrics.hrv > 0 ? "\(networkManager.biometrics.hrv) ms" : "No data"
    }
    
    var sleepString: String {
        let sleepVal = networkManager.biometrics.sleep
        if sleepVal > 0 {
            let hours = Int(sleepVal)
            let minutes = Int(round((sleepVal - Double(hours)) * 60))
            if minutes == 60 {
                return "\(hours + 1)h 0m"
            }
            return "\(hours)h \(minutes)m"
        } else {
            return "No data"
        }
    }
    
    var rhrString: String {
        networkManager.biometrics.rhr > 0 ? "\(networkManager.biometrics.rhr) bpm" : "No data"
    }
    
    var weightString: String {
        networkManager.biometrics.weight > 0 ? String(format: "%.1f lbs", networkManager.biometrics.weight) : "No data"
    }
    
    func formatBiometricTime(_ timeStr: String?) -> String {
        guard let str = timeStr, !str.isEmpty, str != "No data" else { return "No data" }
        if str.contains("1899") || str.contains("GMT") {
            let parts = str.components(separatedBy: " ")
            if parts.count >= 5 {
                let timePart = parts[4]
                let timeComponents = timePart.components(separatedBy: ":")
                if timeComponents.count >= 2 {
                    if let hour = Int(timeComponents[0]), let min = Int(timeComponents[1]) {
                        let ampm = hour >= 12 ? "PM" : "AM"
                        let displayHour = hour == 0 ? 12 : (hour > 12 ? hour - 12 : hour)
                        return String(format: "%d:%02d %@", displayHour, min, ampm)
                    }
                }
            }
        }
        return str
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                
                // Header
                HStack {
                    VStack(alignment: .leading) {
                        Text("🧠 Central OS")
                            .font(.system(size: 28, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                        Text(networkManager.dateStr)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundColor(.gray)
                    }
                    Spacer()
                    if networkManager.isLoading {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    } else {
                        Button(action: { networkManager.fetchData() }) {
                            Image(systemName: "arrow.clockwise.circle.fill")
                                .font(.system(size: 24))
                                .foregroundColor(.white)
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.top, 8)
                
                // Daily Steps Tracker
                VStack(alignment: .leading, spacing: 8) {
                    Text("Daily Steps Tracker")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    HStack {
                        VStack(alignment: .leading) {
                            Text("\(networkManager.biometrics.steps)")
                                .font(.system(size: 32, weight: .black, design: .rounded))
                                .foregroundColor(neonGreen)
                            Text("/ 10,000 steps")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.gray)
                        }
                        Spacer()
                        ZStack {
                            Circle()
                                .stroke(Color.white.opacity(0.05), lineWidth: 8)
                                .frame(width: 50, height: 50)
                            Circle()
                                .trim(from: 0.0, to: CGFloat(min(Double(networkManager.biometrics.steps) / 10000.0, 1.0)))
                                .stroke(neonGreen, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                                .frame(width: 50, height: 50)
                                .rotationEffect(Angle(degrees: -90))
                            
                            Text("\(Int(min(Double(networkManager.biometrics.steps) / 10000.0, 1.0) * 100))%")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(.white)
                        }
                    }
                    .padding()
                    .background(cardBgColor)
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                }
                .padding(.horizontal)
                
                // Biometrics Grid
                VStack(alignment: .leading, spacing: 8) {
                    Text("Biometrics Command Center")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        BiometricCard(title: "HRV (Variability)", val: hrvString, color: cyanColor, cardBg: cardBgColor, cardBorder: cardBorderColor)
                        BiometricCard(title: "Sleep Duration", val: sleepString, color: yellowColor, cardBg: cardBgColor, cardBorder: cardBorderColor)
                        BiometricCard(title: "Fell Asleep", val: formatBiometricTime(networkManager.biometrics.sleepTime), color: yellowColor, cardBg: cardBgColor, cardBorder: cardBorderColor)
                        BiometricCard(title: "Wake Up Time", val: formatBiometricTime(networkManager.biometrics.wakeTime), color: lavenderColor, cardBg: cardBgColor, cardBorder: cardBorderColor)
                        BiometricCard(title: "Resting Heart Rate", val: rhrString, color: redColor, cardBg: cardBgColor, cardBorder: cardBorderColor)
                        BiometricCard(title: "Bodyweight", val: weightString, color: neonGreen, cardBg: cardBgColor, cardBorder: cardBorderColor)
                    }
                }
                .padding(.horizontal)
                
                // Quick-Toggle Daily Habits
                VStack(alignment: .leading, spacing: 8) {
                    Text("⚡ Today's Habits")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    VStack(spacing: 12) {
                        HabitRow(title: "Wake Up On Time", icon: "⏰", isCompleted: networkManager.habits.wakeUpOnTime, color: lavenderColor, cardBg: cardBgColor, cardBorder: cardBorderColor, action: {
                            networkManager.toggleHabit(habitName: "Wake Up On Time", completed: !networkManager.habits.wakeUpOnTime)
                        })
                        HabitRow(title: "Gym Workout", icon: "💪", isCompleted: networkManager.habits.gymWorkout, color: neonGreen, cardBg: cardBgColor, cardBorder: cardBorderColor, action: {
                            networkManager.toggleHabit(habitName: "Gym Workout", completed: !networkManager.habits.gymWorkout)
                        })
                        HabitRow(title: "Journaling", icon: "✍️", isCompleted: networkManager.habits.journaling, color: cyanColor, cardBg: cardBgColor, cardBorder: cardBorderColor, action: {
                            networkManager.toggleHabit(habitName: "Journaling", completed: !networkManager.habits.journaling)
                        })
                    }
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
        .background(bgColor.ignoresSafeArea())
        .refreshable {
            networkManager.fetchData()
        }
    }
}

struct WeeklyVolume: Identifiable {
    let id = UUID()
    let label: String
    let volume: Double
}

struct PersonalRecord: Identifiable {
    let id = UUID()
    let exercise: String
    let maxWeight: Double
    let est1RM: Double
}

struct MuscleRecovery: Identifiable {
    let id = UUID()
    let name: String
    let lastTrainedStr: String
    let status: String
    let percentage: Int
    let recoveryColor: Color
}

struct BiometricTrendChart: View {
    let data: [BiometricsHistoryItem]
    let metric: String // "HRV", "Sleep Duration", "RHR", "Steps"
    let accentColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    
    var values: [Double] {
        data.map { item in
            switch metric {
            case "HRV": return Double(item.hrv)
            case "Sleep Duration": return item.sleep
            case "RHR": return Double(item.rhr)
            case "Steps": return Double(item.steps)
            default: return 0.0
            }
        }
    }
    
    var labels: [String] {
        data.map { item in
            let parts = item.date.components(separatedBy: "-")
            if parts.count >= 3 {
                return "\(parts[1])/\(parts[2])"
            }
            return item.date
        }
    }
    
    var body: some View {
        let chartValues = Array(values.prefix(7).reversed())
        let chartLabels = Array(labels.prefix(7).reversed())
        let maxVal = chartValues.max() ?? 1.0
        
        VStack(alignment: .leading, spacing: 12) {
            Text("All-Time Trajectory Trend Lines: \(metric)")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(.gray)
                .textCase(.uppercase)
            
            HStack(alignment: .bottom, spacing: 10) {
                if chartValues.isEmpty || chartValues.allSatisfy({ $0 == 0 }) {
                    Text("No biometrics history found.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.gray)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 40)
                } else {
                    ForEach(Array(zip(chartValues.indices, chartValues)), id: \.0) { index, val in
                        let label = chartLabels[safe: index] ?? ""
                        VStack(spacing: 8) {
                            ZStack(alignment: .bottom) {
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.white.opacity(0.04))
                                    .frame(height: 100)
                                
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(accentColor)
                                    .frame(height: maxVal > 0 ? CGFloat((val / maxVal)) * 100.0 : 0)
                            }
                            
                            Text(label)
                                .font(.system(size: 8, weight: .bold))
                                .foregroundColor(.gray)
                            
                            Text(metric == "Sleep Duration" ? String(format: "%.1fh", val) : (metric == "Steps" ? "\(Int(val/1000))k" : "\(Int(val))"))
                                .font(.system(size: 8, weight: .black, design: .rounded))
                                .foregroundColor(.white)
                        }
                    }
                }
            }
            .padding()
            .background(cardBgColor)
            .cornerRadius(12)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
        }
    }
}

extension Collection {
    subscript(safe index: Index) -> Element? {
        return indices.contains(index) ? self[index] : nil
    }
}

struct WorkoutWebView: View {
    @ObservedObject var networkManager: NetworkManager
    let bgColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    let neonGreen: Color
    let cyanColor: Color
    let yellowColor: Color
    let redColor: Color
    let lavenderColor: Color
    
    @State private var selectedSubview = 0 // 0: Analytics, 1: Recovery & Readiness
    @State private var selectedMetricIndex = 0 // 0: HRV, 1: Sleep, 2: RHR, 3: Steps
    
    let metrics = ["HRV", "Sleep Duration", "RHR", "Steps"]
    
    var selectedMetricColor: Color {
        switch selectedMetricIndex {
        case 0: return cyanColor
        case 1: return yellowColor
        case 2: return redColor
        default: return neonGreen
        }
    }
    
    func formatSleepDuration(_ hours: Double) -> String {
        if hours <= 0 { return "No data" }
        let h = Int(hours)
        let m = Int(round((hours - Double(h)) * 60.0))
        if m == 60 {
            return "\(h + 1)h 0m"
        }
        return "\(h)h \(m)m"
    }
    
    func formatNumber(_ num: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: num)) ?? "\(num)"
    }
    
    func formatBiometricTime(_ timeStr: String?) -> String {
        guard let str = timeStr, !str.isEmpty, str != "No data" else { return "No data" }
        if str.contains("1899") || str.contains("GMT") {
            let parts = str.components(separatedBy: " ")
            if parts.count >= 5 {
                let timePart = parts[4]
                let timeComponents = timePart.components(separatedBy: ":")
                if timeComponents.count >= 2 {
                    if let hour = Int(timeComponents[0]), let min = Int(timeComponents[1]) {
                        let ampm = hour >= 12 ? "PM" : "AM"
                        let displayHour = hour == 0 ? 12 : (hour > 12 ? hour - 12 : hour)
                        return String(format: "%d:%02d %@", displayHour, min, ampm)
                    }
                }
            }
        }
        return str
    }
    
    // NATIVE CALCULATIONS
    var totalWorkoutsLogged: Int {
        Set(networkManager.recentWorkouts.map { $0.date }).count
    }
    
    var totalGymMinutes: Int {
        let grouped = Dictionary(grouping: networkManager.recentWorkouts, by: { $0.date })
        var total = 0.0
        for (_, sets) in grouped {
            let maxDur = sets.map { $0.duration }.max() ?? 0.0
            total += maxDur
        }
        return Int(total)
    }
    
    var totalVolumeMoved: Int {
        let bodyweight = networkManager.biometrics.weight > 0 ? networkManager.biometrics.weight : 170.0
        var total = 0.0
        for wSet in networkManager.recentWorkouts {
            let exe = wSet.exercise.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            let isCardio = exe.contains("treadmill") || exe.contains("run") || exe.contains("walk") || exe.contains("bike") || exe.contains("cycle") || exe.contains("elliptical") || exe.contains("cardio")
            if isCardio { continue }
            
            let isBodyweight = exe.contains("pull up") || exe.contains("pull-up") || exe.contains("chin up") || exe.contains("chin-up") || exe.contains("knee raise") || exe.contains("leg raise") || exe.contains("push up") || exe.contains("pushup") || exe.contains("dip") || exe.contains("bodyweight") || wSet.weight == 0
            
            let effectiveWeight = isBodyweight ? bodyweight : wSet.weight
            total += effectiveWeight * Double(wSet.reps)
        }
        return Int(total)
    }
    
    var exercisesTrackedCount: Int {
        Set(networkManager.recentWorkouts.map { $0.exercise.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) }).count
    }
    
    var weeklyVolumes: [WeeklyVolume] {
        let calendar = Calendar.current
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "America/Toronto")
        
        let bodyweight = networkManager.biometrics.weight > 0 ? networkManager.biometrics.weight : 170.0
        
        var weeklySums: [String: Double] = [:]
        
        for wSet in networkManager.recentWorkouts {
            guard let date = formatter.date(from: wSet.date) else { continue }
            let weekOfYear = calendar.component(.weekOfYear, from: date)
            let year = calendar.component(.year, from: date)
            let weekKey = String(format: "%d-W%02d", year, weekOfYear)
            
            let exe = wSet.exercise.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            let isCardio = exe.contains("treadmill") || exe.contains("run") || exe.contains("walk") || exe.contains("bike") || exe.contains("cycle") || exe.contains("elliptical") || exe.contains("cardio")
            if isCardio { continue }
            
            let isBodyweight = exe.contains("pull up") || exe.contains("pull-up") || exe.contains("chin up") || exe.contains("chin-up") || exe.contains("knee raise") || exe.contains("leg raise") || exe.contains("push up") || exe.contains("pushup") || exe.contains("dip") || exe.contains("bodyweight") || wSet.weight == 0
            
            let effectiveWeight = isBodyweight ? bodyweight : wSet.weight
            let setVolume = effectiveWeight * Double(wSet.reps)
            
            weeklySums[weekKey, default: 0.0] += setVolume
        }
        
        let sortedKeys = weeklySums.keys.sorted().suffix(5)
        var result: [WeeklyVolume] = []
        for key in sortedKeys {
            let parts = key.components(separatedBy: "-W")
            let label = parts.count > 1 ? "Wk \(parts[1])" : key
            result.append(WeeklyVolume(label: label, volume: weeklySums[key] ?? 0.0))
        }
        
        if result.isEmpty {
            return [
                WeeklyVolume(label: "Wk 1", volume: 0.0),
                WeeklyVolume(label: "Wk 2", volume: 0.0)
            ]
        }
        return result
    }
    
    var personalRecords: [PersonalRecord] {
        var recordsMap: [String: (Double, Double)] = [:]
        
        for wSet in networkManager.recentWorkouts {
            let exe = wSet.exercise
            let exeLower = exe.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            let isCardio = exeLower.contains("treadmill") || exeLower.contains("run") || exeLower.contains("walk") || exeLower.contains("bike") || exeLower.contains("cycle") || exeLower.contains("elliptical") || exeLower.contains("cardio")
            if isCardio { continue }
            
            let est1RM = wSet.reps > 1 ? wSet.weight * (1.0 + Double(wSet.reps)/30.0) : wSet.weight
            
            let existing = recordsMap[exe] ?? (0.0, 0.0)
            let newMaxWeight = max(existing.0, wSet.weight)
            let newMax1RM = max(existing.1, est1RM)
            
            recordsMap[exe] = (newMaxWeight, newMax1RM)
        }
        
        return recordsMap.map { PersonalRecord(exercise: $0.key, maxWeight: $0.value.0, est1RM: $0.value.1) }
            .sorted(by: { $0.est1RM > $1.est1RM })
    }
    
    var muscleRecoveries: [MuscleRecovery] {
        let muscleTargets = ["Chest", "Shoulders", "Triceps", "Back", "Biceps", "Quads", "Hamstrings & Glutes", "Calves", "Abs/Core"]
        var recoveries: [MuscleRecovery] = []
        
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "America/Toronto")
        
        let now = Date()
        
        for muscle in muscleTargets {
            let matchingSets = networkManager.recentWorkouts.filter { wSet in
                let resolved = resolveAnatomy(exercise: wSet.exercise, splitDay: "")
                return resolved == muscle
            }
            
            if matchingSets.isEmpty {
                recoveries.append(MuscleRecovery(
                    name: muscle,
                    lastTrainedStr: "No record found",
                    status: "Optimized (100% Repaired)",
                    percentage: 100,
                    recoveryColor: neonGreen
                ))
                continue
            }
            
            let dates = matchingSets.compactMap { formatter.date(from: $0.date) }
            guard let latestDate = dates.max() else {
                recoveries.append(MuscleRecovery(
                    name: muscle,
                    lastTrainedStr: "No record found",
                    status: "Optimized (100% Repaired)",
                    percentage: 100,
                    recoveryColor: neonGreen
                ))
                continue
            }
            
            let diffSeconds = now.timeIntervalSince(latestDate)
            let hoursSince = max(0, Int(diffSeconds / 3600.0))
            
            let outFormatter = DateFormatter()
            outFormatter.dateFormat = "E, MMM d"
            let lastTrainedStr = "Last hit: \(outFormatter.string(from: latestDate))"
            
            var status = ""
            var percentage = 100
            var color: Color = neonGreen
            
            if hoursSince >= 48 {
                status = "Optimized (100% Repaired)"
                percentage = 100
                color = neonGreen
            } else if hoursSince >= 24 {
                percentage = Int((Double(hoursSince) / 48.0) * 100.0)
                status = "Rebuilding (\(percentage)%)"
                color = .orange
            } else {
                percentage = max(5, Int((Double(hoursSince) / 48.0) * 100.0))
                status = "Fatigued (\(percentage)%)"
                color = .red
            }
            
            recoveries.append(MuscleRecovery(
                name: muscle,
                lastTrainedStr: lastTrainedStr,
                status: status,
                percentage: percentage,
                recoveryColor: color
            ))
        }
        return recoveries
    }
    
    func resolveAnatomy(exercise: String, splitDay: String) -> String {
        let exe = exercise.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if ["knee raise", "ab ", "ab,", "crunch", "woodchopper", "twist", "plank", "leg raise"].contains(where: { exe.contains($0) }) {
            return "Abs/Core"
        }
        if ["squat", "leg press", "lunge", "quad", "leg extension"].contains(where: { exe.contains($0) }) {
            if exe.contains("tricep") { return "Triceps" }
            return "Quads"
        }
        if ["rdl", "romanian", "leg curl", "hamstring", "glute", "hip thrust"].contains(where: { exe.contains($0) }) {
            if exe.contains("bicep") || exe.contains("hammer") { return "Biceps" }
            return "Hamstrings & Glutes"
        }
        if exe.contains("calf") || exe.contains("calves") { return "Calves" }
        if ["bench", "fly", "pushup", "chest", "pec"].contains(where: { exe.contains($0) }) { return "Chest" }
        if ["lateral raise", "overhead press", "shoulder", "delt", "face pull", "military"].contains(where: { exe.contains($0) }) { return "Shoulders" }
        if exe.contains("tricep") || exe.contains("kickback") || exe.contains("pushdown") { return "Triceps" }
        if ["pull-up", "row", "lat", "chin-up", "back", "deadlift"].contains(where: { exe.contains($0) }) { return "Back" }
        if exe.contains("bicep") || exe.contains("curl") || exe.contains("hammer") { return "Biceps" }
        if ["treadmill", "run", "walk", "bike", "cardio"].contains(where: { exe.contains($0) }) { return "Cardio" }
        
        let split = splitDay.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if split.contains("push") { return "Chest" }
        if split.contains("pull") { return "Back" }
        if split.contains("leg") { return "Quads" }
        if split.contains("cardio") { return "Cardio" }
        return "Other"
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("🏋️ Workout Insights")
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                Spacer()
                if networkManager.isLoading {
                    ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Button(action: { networkManager.fetchData() }) {
                        Image(systemName: "arrow.clockwise.circle.fill")
                            .font(.system(size: 24))
                            .foregroundColor(.white)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .background(bgColor)
            
            // Sub-navigation picker
            Picker("View Selection", selection: $selectedSubview) {
                Text("📈 Analytics").tag(0)
                Text("❤️ Recovery").tag(1)
            }
            .pickerStyle(SegmentedPickerStyle())
            .padding(.horizontal)
            .padding(.bottom, 12)
            .background(bgColor)
            
            ScrollView {
                VStack(spacing: 20) {
                    if selectedSubview == 0 {
                        // --- SUBSCENE 1: PREMIUM ANALYTICS ---
                        
                        // Stat Cards Grid
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            // Total Workouts
                            VStack(alignment: .center, spacing: 6) {
                                Text("\(totalWorkoutsLogged)")
                                    .font(.system(size: 26, weight: .black, design: .rounded))
                                    .foregroundColor(neonGreen)
                                Text("Total Workouts")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.gray)
                                    .textCase(.uppercase)
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(10)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                            
                            // Time Invested
                            VStack(alignment: .center, spacing: 6) {
                                Text("\(totalGymMinutes / 60)h \(totalGymMinutes % 60)m")
                                    .font(.system(size: 26, weight: .black, design: .rounded))
                                    .foregroundColor(cyanColor)
                                Text("Time Invested")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.gray)
                                    .textCase(.uppercase)
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(10)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                            
                            // Total Tonnage
                            VStack(alignment: .center, spacing: 6) {
                                Text(String(format: "%dk lbs", totalVolumeMoved / 1000))
                                    .font(.system(size: 26, weight: .black, design: .rounded))
                                    .foregroundColor(yellowColor)
                                Text("Hevy Volume")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.gray)
                                    .textCase(.uppercase)
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(10)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                            
                            // Exercises Tracked
                            VStack(alignment: .center, spacing: 6) {
                                Text("\(exercisesTrackedCount)")
                                    .font(.system(size: 26, weight: .black, design: .rounded))
                                    .foregroundColor(lavenderColor)
                                Text("Exercises")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.gray)
                                    .textCase(.uppercase)
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(10)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                        }
                        
                        // Volume Trend Chart
                        let volumes = weeklyVolumes
                        let maxVol = volumes.map { $0.volume }.max() ?? 1.0
                        
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Weekly Volume Progression (lbs)")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.gray)
                                .textCase(.uppercase)
                            
                            HStack(alignment: .bottom, spacing: 12) {
                                ForEach(volumes) { item in
                                    VStack(spacing: 8) {
                                        ZStack(alignment: .bottom) {
                                            RoundedRectangle(cornerRadius: 4)
                                                .fill(Color.white.opacity(0.04))
                                                .frame(height: 120)
                                            
                                            RoundedRectangle(cornerRadius: 4)
                                                .fill(cyanColor)
                                                .frame(height: maxVol > 0 ? CGFloat((item.volume / maxVol)) * 120.0 : 0)
                                        }
                                        
                                        Text(item.label)
                                            .font(.system(size: 10, weight: .bold))
                                            .foregroundColor(.gray)
                                        
                                        Text(String(format: "%dK", Int(item.volume / 1000.0)))
                                            .font(.system(size: 9, weight: .black, design: .rounded))
                                            .foregroundColor(.white)
                                    }
                                }
                            }
                            .padding()
                            .background(cardBgColor)
                            .cornerRadius(12)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                        }
                        
                        // Personal records table
                        VStack(alignment: .leading, spacing: 8) {
                            Text("🏆 Strongest Lifts (Hevy PRs)")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.gray)
                                .textCase(.uppercase)
                            
                            let prs = personalRecords
                            if prs.isEmpty {
                                Text("No strength logs found.")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(.gray)
                                    .padding()
                                    .frame(maxWidth: .infinity)
                                    .background(cardBgColor)
                                    .cornerRadius(12)
                                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                            } else {
                                VStack(spacing: 8) {
                                    ForEach(prs.prefix(6)) { pr in
                                        HStack {
                                            Text(pr.exercise)
                                                .font(.system(size: 14, weight: .black, design: .rounded))
                                                .foregroundColor(.white)
                                                .lineLimit(1)
                                            Spacer()
                                            VStack(alignment: .trailing, spacing: 2) {
                                                Text("\(Int(pr.maxWeight)) lbs")
                                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                                    .foregroundColor(neonGreen)
                                                Text("Est. 1RM: \(Int(pr.est1RM)) lbs")
                                                    .font(.system(size: 10, weight: .bold))
                                                    .foregroundColor(.gray)
                                            }
                                        }
                                        .padding()
                                        .background(cardBgColor)
                                        .cornerRadius(10)
                                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                                    }
                                }
                            }
                        }
                        
                        // Muscle Recovery Matrix
                        VStack(alignment: .leading, spacing: 10) {
                            Text("🧬 Premium Muscle Recovery Matrix")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.gray)
                                .textCase(.uppercase)
                            
                            VStack(spacing: 8) {
                                ForEach(muscleRecoveries) { recovery in
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack {
                                            Text(recovery.name)
                                                .font(.system(size: 14, weight: .black, design: .rounded))
                                                .foregroundColor(.white)
                                            Spacer()
                                            Text(recovery.lastTrainedStr)
                                                .font(.system(size: 11, weight: .bold))
                                                .foregroundColor(.gray)
                                        }
                                        
                                        HStack {
                                            Text("Status: \(recovery.status)")
                                                .font(.system(size: 12, weight: .medium))
                                                .foregroundColor(.white.opacity(0.8))
                                            Spacer()
                                        }
                                        
                                        // Progress Bar
                                        GeometryReader { geometry in
                                            ZStack(alignment: .leading) {
                                                RoundedRectangle(cornerRadius: 3)
                                                    .fill(Color.white.opacity(0.06))
                                                    .frame(height: 6)
                                                RoundedRectangle(cornerRadius: 3)
                                                    .fill(recovery.recoveryColor)
                                                    .frame(width: CGFloat(recovery.percentage) / 100.0 * geometry.size.width, height: 6)
                                            }
                                        }
                                        .frame(height: 6)
                                    }
                                    .padding()
                                    .background(cardBgColor)
                                    .cornerRadius(10)
                                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                                }
                            }
                        }
                        
                    } else {
                        // --- SUBSCENE 2: RECOVERY & READINESS ---
                        
                        // All-Time Baseline Recovery Metrics Grid (Latest Day metrics)
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            // Latest HRV
                            VStack(alignment: .center, spacing: 6) {
                                Text(networkManager.biometrics.hrv > 0 ? "\(networkManager.biometrics.hrv) ms" : "No data")
                                    .font(.system(size: 26, weight: .black, design: .rounded))
                                    .foregroundColor(cyanColor)
                                Text("Latest HRV")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.gray)
                                    .textCase(.uppercase)
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(10)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                            
                            // Latest Sleep
                            VStack(alignment: .center, spacing: 6) {
                                Text(formatSleepDuration(networkManager.biometrics.sleep))
                                    .font(.system(size: 26, weight: .black, design: .rounded))
                                    .foregroundColor(yellowColor)
                                Text("Latest Sleep")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.gray)
                                    .textCase(.uppercase)
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(10)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                            
                            // Latest RHR
                            VStack(alignment: .center, spacing: 6) {
                                Text(networkManager.biometrics.rhr > 0 ? "\(networkManager.biometrics.rhr) bpm" : "No data")
                                    .font(.system(size: 26, weight: .black, design: .rounded))
                                    .foregroundColor(redColor)
                                Text("Latest RHR")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.gray)
                                    .textCase(.uppercase)
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(10)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                            
                            // Latest Steps
                            VStack(alignment: .center, spacing: 6) {
                                Text(networkManager.biometrics.steps > 0 ? "\(formatNumber(networkManager.biometrics.steps))" : "No data")
                                    .font(.system(size: 24, weight: .black, design: .rounded))
                                    .foregroundColor(neonGreen)
                                Text("Latest Steps")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.gray)
                                    .textCase(.uppercase)
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(10)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                        }
                        
                        // Trajectory Trend Selector
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Select Core Biometric Overlay")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.gray)
                                .textCase(.uppercase)
                            
                            Picker("Metric Selection", selection: $selectedMetricIndex) {
                                Text("HRV").tag(0)
                                Text("Sleep").tag(1)
                                Text("RHR").tag(2)
                                Text("Steps").tag(3)
                            }
                            .pickerStyle(SegmentedPickerStyle())
                        }
                        .padding(.vertical, 8)
                        
                        // Biometric Trend Chart
                        BiometricTrendChart(
                            data: networkManager.biometricsHistory,
                            metric: metrics[selectedMetricIndex],
                            accentColor: selectedMetricColor,
                            cardBgColor: cardBgColor,
                            cardBorderColor: cardBorderColor
                        )
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 20)
            }
            .background(bgColor.ignoresSafeArea())
        }
        .background(bgColor.ignoresSafeArea())
    }
}

// =========================================================================
// 🏋️ VIEW 2: WORKOUT LOGGER
// =========================================================================
struct WorkoutLoggerView: View {
    @ObservedObject var networkManager: NetworkManager
    let bgColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    let neonGreen: Color
    let cyanColor: Color
    
    // Quick log variables
    @State private var exerciseName: String = "Treadmill"
    @State private var reps: Int = 10
    @State private var weight: Double = 0.0
    @State private var duration: Double = 20.0
    @State private var distance: Double = 2.0
    @State private var splitDay: String = "Cardio"
    @State private var showingSuccessAlert = false
    @State private var isSubmitting = false
    
    let exercisesList = ["Treadmill", "Bench Press (Dumbbell)", "Bench Press (Barbell)", "Squat (Barbell)", "Bent Over Row (Barbell)", "Pull Up", "Romanian Deadlift (Barbell)", "Lateral Raise (Cable)", "Triceps Extension (Cable)", "Seated Incline Curl (Dumbbell)"]
    let splitsList = ["Cardio", "Push (Chest/Shoulders/Triceps)", "Pull (Back/Biceps)", "Legs & Abs"]
    
    // Computed property to prevent compilation type-check timeouts
    var recentWorkoutsList: [WorkoutSet] {
        Array(networkManager.recentWorkouts.prefix(15))
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                
                // Title
                Text("🏋️ Workouts Ledger")
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                    .padding(.horizontal)
                    .padding(.top, 8)
                
                // Quick Logging Form
                VStack(alignment: .leading, spacing: 12) {
                    Text("Log Workout Set")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                    
                    // Select Split
                    HStack {
                        Text("Workout Split:")
                            .font(.system(size: 13, weight: .semibold)).foregroundColor(.gray)
                        Spacer()
                        Picker("Split", selection: $splitDay) {
                            ForEach(splitsList, id: \.self) { Text($0.prefix(12)).tag($0) }
                        }
                        .pickerStyle(MenuPickerStyle())
                        .foregroundColor(.white)
                    }
                    Divider().background(Color.white.opacity(0.1))
                    
                    // Select/Enter Exercise
                    HStack {
                        Text("Exercise Name:")
                            .font(.system(size: 13, weight: .semibold)).foregroundColor(.gray)
                        Spacer()
                        Picker("Exercise", selection: $exerciseName) {
                            ForEach(exercisesList, id: \.self) { Text($0).tag($0) }
                        }
                        .pickerStyle(MenuPickerStyle())
                        .foregroundColor(.white)
                    }
                    
                    // Numeric Steppers
                    VStack(spacing: 8) {
                        if exerciseName.lowercased().contains("treadmill") {
                            // Duration
                            HStack {
                                Text("Duration (Mins)")
                                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.gray)
                                Spacer()
                                Stepper("\(String(format: "%.1f", duration))m", value: $duration, in: 1.0...180.0, step: 0.5)
                                    .foregroundColor(.white)
                                    .frame(width: 140)
                            }
                            // Distance
                            HStack {
                                Text("Distance (Miles)")
                                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.gray)
                                Spacer()
                                Stepper("\(String(format: "%.2f", distance)) mi", value: $distance, in: 0.0...26.0, step: 0.1)
                                    .foregroundColor(.white)
                                    .frame(width: 140)
                            }
                        } else {
                            // Weight
                            HStack {
                                Text("Working Weight (lbs)")
                                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.gray)
                                Spacer()
                                Stepper("\(Int(weight)) lbs", value: $weight, in: 0.0...600.0, step: 5.0)
                                    .foregroundColor(.white)
                                    .frame(width: 140)
                            }
                            // Repetitions
                            HStack {
                                Text("Reps Completed")
                                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.gray)
                                Spacer()
                                Stepper("\(reps) reps", value: $reps, in: 0...50)
                                    .foregroundColor(.white)
                                    .frame(width: 140)
                            }
                        }
                    }
                    
                    // Submit Button
                    Button(action: {
                        isSubmitting = true
                        networkManager.logWorkoutSet(exercise: exerciseName, weight: weight, reps: reps, duration: duration, distance: distance, splitDay: splitDay) { success in
                            DispatchQueue.main.async {
                                isSubmitting = false
                                if success {
                                    showingSuccessAlert = true
                                    // Reset fields
                                    self.weight = 0.0
                                    self.reps = 10
                                }
                            }
                        }
                    }) {
                        HStack {
                            if isSubmitting {
                                ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .black))
                            } else {
                                Image(systemName: "checkmark.seal.fill")
                                Text("Upload Set to Sheets")
                                    .font(.system(size: 14, weight: .black, design: .rounded))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(neonGreen)
                        .foregroundColor(.black)
                        .cornerRadius(10)
                        .shadow(color: neonGreen.opacity(0.3), radius: 5)
                    }
                    .disabled(isSubmitting)
                }
                .padding()
                .background(cardBgColor)
                .cornerRadius(12)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                .padding(.horizontal)
                .alert(isPresented: $showingSuccessAlert) {
                    Alert(title: Text("Log Injected"), message: Text("Success! This set has been pushed to Google Sheets and your 'Gym Workout' habit checked off!"), dismissButton: .default(Text("Perfect")))
                }
                
                // Recent Sets List
                VStack(alignment: .leading, spacing: 8) {
                    Text("Recent Training Logs")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                        .padding(.horizontal)
                    
                    if recentWorkoutsList.isEmpty {
                        Text("No recent workout history found.")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.gray)
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(12)
                            .padding(.horizontal)
                    } else {
                        VStack(spacing: 8) {
                            ForEach(recentWorkoutsList) { setRow in
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(setRow.exercise)
                                            .font(.system(size: 14, weight: .black, design: .rounded))
                                            .foregroundColor(.white)
                                        Text("\(setRow.date) • Set \(setRow.setNumber)")
                                            .font(.system(size: 11, weight: .bold))
                                            .foregroundColor(.gray)
                                    }
                                    Spacer()
                                    
                                    // Metrics display
                                    if setRow.exercise.lowercased().contains("treadmill") {
                                        VStack(alignment: .trailing) {
                                            Text(String(format: "%.2f km", setRow.distance))
                                                .font(.system(size: 14, weight: .bold, design: .rounded))
                                                .foregroundColor(cyanColor)
                                            Text(String(format: "%.1f mins", setRow.duration))
                                                .font(.system(size: 11))
                                                .foregroundColor(.gray)
                                        }
                                    } else {
                                        VStack(alignment: .trailing) {
                                            Text("\(Int(setRow.weight)) lbs")
                                                .font(.system(size: 14, weight: .bold, design: .rounded))
                                                .foregroundColor(neonGreen)
                                            Text("\(setRow.reps) reps")
                                                .font(.system(size: 11))
                                                .foregroundColor(.gray)
                                        }
                                    }
                                }
                                .padding()
                                .background(cardBgColor)
                                .cornerRadius(10)
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                            }
                        }
                        .padding(.horizontal)
                    }
                }
            }
            .padding(.vertical)
        }
        .background(bgColor.ignoresSafeArea())
    }
}

// =========================================================================
// ⚡ VIEW 3: HABITS CHECKLIST
// =========================================================================
struct HabitsHistoryView: View {
    @ObservedObject var networkManager: NetworkManager
    let bgColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    let neonGreen: Color
    let cyanColor: Color
    let lavenderColor: Color
    
    // Computed property to prevent compilation type-check timeouts
    var recentHabitsList: [HabitDay] {
        Array(networkManager.habitHistory.prefix(7))
    }
    
    // Streaks calculations
    var currentStreak: Int {
        var streak = 0
        for day in networkManager.habitHistory {
            // Count a day if they hit at least 2 habits
            let hitCount = (day.wakeUpOnTime ? 1 : 0) + (day.gymWorkout ? 1 : 0) + (day.journaling ? 1 : 0)
            if hitCount >= 2 {
                streak += 1
            } else {
                break
            }
        }
        return streak
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                
                // Title
                Text("⚡ Streak & Habit OS")
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                    .padding(.horizontal)
                    .padding(.top, 8)
                
                // Streak Card
                VStack(alignment: .center, spacing: 6) {
                    Text("Habit Streak")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    Text("\(currentStreak) Days")
                        .font(.system(size: 42, weight: .black, design: .rounded))
                        .foregroundColor(neonGreen)
                    
                    Text("Consistently hitting 2+ habits daily")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(cardBgColor)
                .cornerRadius(12)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                .padding(.horizontal)
                
                // Last 7 Days Grid
                VStack(alignment: .leading, spacing: 8) {
                    Text("7-Day Habit Ledger")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                        .padding(.horizontal)
                    
                    if recentHabitsList.isEmpty {
                        Text("No habit history synced yet.")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.gray)
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(12)
                            .padding(.horizontal)
                    } else {
                        VStack(spacing: 8) {
                            ForEach(recentHabitsList) { day in
                                HStack {
                                    Text(formatDateLabel(day.date))
                                        .font(.system(size: 14, weight: .bold, design: .rounded))
                                        .foregroundColor(.white)
                                    Spacer()
                                    
                                    // Visual switches
                                    HStack(spacing: 12) {
                                        MiniHabitBadge(icon: "⏰", status: day.wakeUpOnTime, activeColor: lavenderColor)
                                        MiniHabitBadge(icon: "💪", status: day.gymWorkout, activeColor: neonGreen)
                                        MiniHabitBadge(icon: "✍️", status: day.journaling, activeColor: cyanColor)
                                    }
                                }
                                .padding()
                                .background(cardBgColor)
                                .cornerRadius(10)
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorderColor, lineWidth: 1))
                            }
                        }
                        .padding(.horizontal)
                    }
                }
            }
            .padding(.vertical)
        }
        .background(bgColor.ignoresSafeArea())
    }
    
    func formatDateLabel(_ dateString: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        if let date = formatter.date(from: dateString) {
            let outputFormatter = DateFormatter()
            outputFormatter.dateFormat = "E, MMM d"
            return outputFormatter.string(from: date)
        }
        return dateString
    }
}

struct MiniHabitBadge: View {
    let icon: String
    let status: Bool
    let activeColor: Color
    
    var body: some View {
        HStack(spacing: 4) {
            Text(icon).font(.system(size: 12))
            Image(systemName: status ? "checkmark.circle.fill" : "xmark.circle")
                .foregroundColor(status ? .black : .gray.opacity(0.4))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(status ? activeColor : Color.white.opacity(0.05))
        .cornerRadius(6)
    }
}

// =========================================================================
// 🥗 VIEW 4: MEAL PREP & COSTCO CHECKLIST
// =========================================================================
struct MealPrepView: View {
    @ObservedObject var networkManager: NetworkManager
    let bgColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    let yellowColor: Color
    let cyanColor: Color
    let neonGreen: Color
    
    @State private var selectedTripIdx = 0
    @State private var activeWeek = 1
    
    // Store checklist items completed states on device
    @AppStorage("completed_costco_items") private var completedItemsData: String = ""
    
    // Computed property for Costco checklist filtering
    var filteredCostcoItems: [CostcoItem] {
        let filter = selectedTripIdx == 0 ? "trip 1" : "trip 2"
        return networkManager.costcoItems.filter { $0.trip.lowercased().contains(filter) }
    }
    
    // Computed property for Costco checklist department grouping
    var groupedCostcoItems: [String: [CostcoItem]] {
        Dictionary(grouping: filteredCostcoItems, by: { $0.department })
    }
    
    // Computed property to prevent sorted departments type-check timeouts
    var sortedDepartments: [String] {
        groupedCostcoItems.keys.sorted()
    }
    
    var completedItems: Set<String> {
        let list = completedItemsData.components(separatedBy: ",")
        return Set(list.filter { !$0.isEmpty })
    }
    

    
    // Computed properties for Weekly Menu Blueprint
    var smoothieFruit: String {
        activeWeek % 2 == 1 ? "Frozen Mango Chunks" : "Frozen Three Berry Blend"
    }
    
    var lunchTitle: String {
        activeWeek <= 2 ? "Beef, Egg, & Fresh Spinach Burritos" : "Zero-Prep Pulled Chicken & Spinach Wraps"
    }
    
    var lunchGuide: String {
        activeWeek <= 2 ?
            "Warm up seasoned ground beef, scramble fresh eggs, and roll tightly into 2 wraps packed with raw fresh spinach." :
            "Layer 2 wraps with fresh spinach and stuff with cold rotisserie chicken. Add hot sauce, wrap, and pack."
    }
    
    var dinnerProt: String {
        activeWeek == 1 ? "Seasoned Chicken Breasts" : (activeWeek == 2 ? "Kirkland Frozen Salmon Fillets" : (activeWeek == 3 ? "Seasoned Chicken Breasts" : "Thawed Tail-Off Shrimp"))
    }
    
    var dinnerVeg: String {
        activeWeek <= 2 ? "Frozen Broccoli & Corn" : "Frozen Stir-Fry Veg Blend"
    }
    
    var airfryTime: String {
        activeWeek == 4 ? "6 minutes at 400°F" : "15-18 minutes at 400°F"
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                
                // Title
                Text("🥗 Meal Prep Planner")
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundColor(.white)
                    .padding(.horizontal)
                    .padding(.top, 8)
                
                // Segment Trip Selector
                Picker("Shopping Trip", selection: $selectedTripIdx) {
                    Text("Trip 1 (Master Stock)").tag(0)
                    Text("Trip 2 (Refresh)").tag(1)
                }
                .pickerStyle(SegmentedPickerStyle())
                .padding(.horizontal)
                
                // Costco Shopping checklist
                VStack(alignment: .leading, spacing: 8) {
                    Text("Costco Grocery Checklist")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                        .padding(.horizontal)
                    
                    if filteredCostcoItems.isEmpty {
                        Text("No grocery items loaded. Pull down to refresh.")
                            .font(.system(size: 13))
                            .foregroundColor(.gray)
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(cardBgColor)
                            .cornerRadius(12)
                            .padding(.horizontal)
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(sortedDepartments, id: \.self) { dept in
                                VStack(alignment: .leading, spacing: 6) {
                                    // Department Header
                                    Text(dept.uppercased())
                                        .font(.system(size: 12, weight: .black))
                                        .foregroundColor(yellowColor)
                                        .padding(.top, 4)
                                    
                                    // Items Checklist
                                    ForEach(groupedCostcoItems[dept] ?? []) { item in
                                        CostcoItemRow(
                                            item: item,
                                            completedItems: Binding(
                                                get: { self.completedItems },
                                                set: { newValue in
                                                    let str = Array(newValue).joined(separator: ",")
                                                    UserDefaults.standard.set(str, forKey: "completed_costco_items")
                                                }
                                            ),
                                            neonGreen: neonGreen,
                                            cardBgColor: cardBgColor,
                                            cardBorderColor: cardBorderColor
                                        )
                                    }
                                }
                            }
                        }
                        .padding(.horizontal)
                    }
                }
                
                Divider().background(Color.white.opacity(0.1)).padding(.horizontal)
                
                // Week Agenda Blueprint selector
                VStack(alignment: .leading, spacing: 8) {
                    Text("Weekly Menu Blueprint")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                        .padding(.horizontal)
                    
                    Picker("Rotation Week", selection: $activeWeek) {
                        Text("Week 1").tag(1)
                        Text("Week 2").tag(2)
                        Text("Week 3").tag(3)
                        Text("Week 4").tag(4)
                    }
                    .pickerStyle(SegmentedPickerStyle())
                    .padding(.horizontal)
                    
                    VStack(spacing: 12) {
                        MealCard(title: "🌅 Breakfast (Blender)", name: "High-Protein Smoothie", workflow: "1.5 cups Milk, 1 cup Vanilla Yogurt, 1 cup \(smoothieFruit), 1 tbsp Chia Seeds, 3 tbsp Hemp Hearts. Swap yogurt with cottage cheese for extra thickness!")
                        
                        MealCard(title: "☀️ Mid-Day Fuel (2 Wraps)", name: lunchTitle, workflow: lunchGuide)
                        
                        MealCard(title: "🌙 Dinner (Air Fryer core)", name: "\(dinnerProt) on Starch Grid", workflow: "Air-fry protein for \(airfryTime). Starch: cooked Jasmine Rice/Quinoa blend. Stir in 2-3 tbsp cottage cheese immediately for a creamy high-protein base! Veg: steam \(dinnerVeg) in microwave at dinner.")
                        
                        MealCard(title: "🌙 Study Fuel (Casein Feed)", name: "Cottage Cheese & Warm Berries", workflow: "1 cup cottage cheese, top with Frozen Berries microwaved for 20 seconds to run the juices. Slow casein protein protects recovery overnight!")
                    }
                    .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
        .background(bgColor.ignoresSafeArea())
    }
}

// Extracted Subview to fix compile speed issues in SwiftUI lists
struct CostcoItemRow: View {
    let item: CostcoItem
    @Binding var completedItems: Set<String>
    let neonGreen: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    
    var isChecked: Bool {
        completedItems.contains(item.id)
    }
    
    var body: some View {
        Button(action: {
            if isChecked {
                completedItems.remove(item.id)
            } else {
                completedItems.insert(item.id)
            }
        }) {
            HStack(alignment: .top) {
                Image(systemName: isChecked ? "checkmark.square.fill" : "square")
                    .foregroundColor(isChecked ? neonGreen : .gray)
                    .font(.system(size: 16))
                    .padding(.top, 2)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundColor(isChecked ? .gray : .white)
                        .strikethrough(isChecked)
                    Text("\(item.size) • \(item.assignment)")
                        .font(.system(size: 11))
                        .foregroundColor(.gray)
                }
                Spacer()
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
            .background(cardBgColor)
            .cornerRadius(8)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(cardBorderColor, lineWidth: 0.5))
        }
    }
}

struct MealCard: View {
    let title: String
    let name: String
    let workflow: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.gray)
                .textCase(.uppercase)
            
            Text(name)
                .font(.system(size: 15, weight: .black, design: .rounded))
                .foregroundColor(.white)
            
            Text(workflow)
                .font(.system(size: 12))
                .foregroundColor(.gray)
                .lineLimit(4)
                .lineSpacing(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(red: 0.09, green: 0.09, blue: 0.11))
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(red: 0.14, green: 0.14, blue: 0.18), lineWidth: 1))
    }
}

struct BiometricCard: View {
    let title: String
    let val: String
    let color: Color
    let cardBg: Color
    let cardBorder: Color
    
    var body: some View {
        VStack(alignment: .center, spacing: 6) {
            Text(title)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.gray)
                .textCase(.uppercase)
                .multilineTextAlignment(.center)
            
            Text(val)
                .font(.system(size: 18, weight: .black, design: .rounded))
                .foregroundColor(color)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .padding(.horizontal, 10)
        .background(cardBg)
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(cardBorder, lineWidth: 1))
    }
}

struct HabitRow: View {
    let title: String
    let icon: String
    let isCompleted: Bool
    let color: Color
    let cardBg: Color
    let cardBorder: Color
    let action: () -> Void
    
    var body: some View {
        HStack {
            Text(icon).font(.system(size: 20))
            
            Text(title)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundColor(.white)
            
            Spacer()
            
            Button(action: action) {
                HStack(spacing: 4) {
                    if isCompleted {
                        Text("Completed").font(.system(size: 11, weight: .bold))
                        Image(systemName: "checkmark.circle.fill")
                    } else {
                        Text("Mark Done").font(.system(size: 11, weight: .bold))
                        Image(systemName: "circle")
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .foregroundColor(isCompleted ? Color.black : Color.white)
                .background(isCompleted ? color : Color.white.opacity(0.05))
                .cornerRadius(8)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(isCompleted ? Color.clear : Color.white.opacity(0.1), lineWidth: 1))
                .shadow(color: isCompleted ? color.opacity(0.3) : Color.clear, radius: 4)
            }
            .animation(.spring(), value: isCompleted)
        }
        .padding()
        .background(cardBg)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorder, lineWidth: 1))
    }
}

// =========================================================================
// 🚀 VIEW 5: MISSION CONTROL
// =========================================================================
struct MissionControlView: View {
    @ObservedObject var networkManager: NetworkManager
    let bgColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    let neonGreen: Color
    let cyanColor: Color
    let yellowColor: Color
    let redColor: Color
    let lavenderColor: Color
    
    @State private var showingAddForm = false
    @State private var selectedFilter = 0 // 0: Upcoming, 1: Tasks, 2: Events
    
    let calendarsList = ["Kevin Nguyen", "Family", "School", "Volunteering"]
    
    func badgeColor(for calendar: String) -> Color {
        switch calendar.lowercased() {
        case "kevin nguyen": return .blue
        case "family": return .red
        case "school": return lavenderColor
        case "volunteering": return yellowColor
        default: return .gray
        }
    }
    
    var filteredItems: [MissionControlItem] {
        let items = networkManager.missionControlItems
        let nowStr = formatDate(Date())
        
        switch selectedFilter {
        case 0: // Upcoming (uncompleted, >= today)
            return items.filter { !$0.status && $0.date >= nowStr }
        case 1: // Tasks (uncompleted tasks)
            return items.filter { !$0.status && $0.type.lowercased() == "task" }
        case 2: // Events (upcoming events)
            return items.filter { !$0.status && $0.type.lowercased() == "event" && $0.date >= nowStr }
        default:
            return items
        }
    }
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Quick Action: Add item
                    Button(action: { showingAddForm = true }) {
                        HStack {
                            Image(systemName: "plus.circle.fill")
                            Text("Log New Event or Task")
                                .font(.system(size: 14, weight: .black, design: .rounded))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(cyanColor)
                        .foregroundColor(.black)
                        .cornerRadius(10)
                    }
                    .padding(.horizontal)
                    .sheet(isPresented: $showingAddForm) {
                        AddMissionItemForm(
                            networkManager: networkManager,
                            calendarsList: calendarsList,
                            badgeColor: badgeColor,
                            bgColor: bgColor,
                            cardBgColor: cardBgColor,
                            cardBorderColor: cardBorderColor,
                            cyanColor: cyanColor,
                            lavenderColor: lavenderColor,
                            isPresented: $showingAddForm
                        )
                    }
                    
                    // Filter Picker
                    Picker("Filter", selection: $selectedFilter) {
                        Text("Upcoming").tag(0)
                        Text("Tasks").tag(1)
                        Text("Events").tag(2)
                    }
                    .pickerStyle(SegmentedPickerStyle())
                    .padding(.horizontal)
                    
                    // Tasks/Events List
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Upcoming Agenda Ledger")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.gray)
                            .textCase(.uppercase)
                            .padding(.horizontal)
                        
                        if filteredItems.isEmpty {
                            Text("No items found in this section.")
                                .font(.system(size: 13))
                                .foregroundColor(.gray)
                                .padding()
                                .frame(maxWidth: .infinity)
                                .background(cardBgColor)
                                .cornerRadius(12)
                                .padding(.horizontal)
                        } else {
                            VStack(spacing: 8) {
                                ForEach(filteredItems) { item in
                                    MissionItemRow(
                                        item: item,
                                        networkManager: networkManager,
                                        badgeColor: badgeColor(for: item.calendar),
                                        cardBgColor: cardBgColor,
                                        cardBorderColor: cardBorderColor,
                                        neonGreen: neonGreen
                                    )
                                }
                            }
                            .padding(.horizontal)
                        }
                    }
                    
                    Divider().background(Color.white.opacity(0.1)).padding(.horizontal)
                    
                    // Embedded Calendar View
                    VStack(alignment: .leading, spacing: 8) {
                        Text("📅 Embedded Master Calendar")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.gray)
                            .textCase(.uppercase)
                            .padding(.horizontal)
                        
                        let embedUrl = "https://calendar.google.com/calendar/embed?wkst=1&ctz=America%2FToronto&showPrint=0&src=MjRrdGtuQGdtYWlsLmNvbQ&src=MGRiYzFmNDBjOWRjOTkzYzZiODkzZmEwZTE2NDZiODg4ZWI4ZWQ4NTk5NjY4Yzk2OTdkNzI2ODllMDQxZTMxNUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=NTdiYjhhOGJmNjFlMjMzZThiYjc2YWIwM2Y1M2IwM2VhZDM1ZTdiYTY2ZTM3ZDJiZmQ3Mzc5MmUxYzFlNTc1ZUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=ZmFtaWx5MDU2NjgyMjcyMTU0MjM1ODcyNTFAZ3JvdXAuY2FsZW5kYXIuZ29vZ2xlLmNvbQ&color=%23039be5&color=%238e24aa&color=%23f6bf26&color=%23d50000"
                        
                        WebView(urlString: embedUrl)
                            .frame(height: 380)
                            .cornerRadius(12)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                            .padding(.horizontal)
                    }
                }
                .padding(.vertical)
            }
            .background(bgColor.ignoresSafeArea())
            .navigationTitle("🚀 Mission Control")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    if networkManager.isLoading {
                        ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .white))
                    } else {
                        Button(action: { networkManager.fetchData() }) {
                            Image(systemName: "arrow.clockwise.circle.fill")
                                .font(.system(size: 20))
                                .foregroundColor(.white)
                        }
                    }
                }
            }
        }
    }
    
    func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

struct AddMissionItemForm: View {
    @ObservedObject var networkManager: NetworkManager
    let calendarsList: [String]
    let badgeColor: (String) -> Color
    let bgColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    let cyanColor: Color
    let lavenderColor: Color
    @Binding var isPresented: Bool
    
    @State private var itemName = ""
    @State private var itemType = "Task"
    @State private var calendarCat = "Kevin Nguyen"
    @State private var targetDate = Date()
    @State private var allDay = false
    @State private var startTime = Date()
    @State private var duration = 60
    @State private var location = ""
    @State private var notes = ""
    @State private var isSubmitting = false
    @State private var showingAlert = false
    @State private var alertMsg = ""
    
    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Core Details").foregroundColor(.gray)) {
                    TextField("Title (e.g., Study Pathology)", text: $itemName)
                        .listRowBackground(cardBgColor)
                    
                    Picker("Type", selection: $itemType) {
                        Text("Task").tag("Task")
                        Text("Event").tag("Event")
                    }
                    .pickerStyle(SegmentedPickerStyle())
                    .listRowBackground(cardBgColor)
                    
                    Picker("Calendar Category", selection: $calendarCat) {
                        ForEach(calendarsList, id: \.self) { Text($0).tag($0) }
                    }
                    .listRowBackground(cardBgColor)
                }
                
                Section(header: Text("Scheduling").foregroundColor(.gray)) {
                    DatePicker("Target Date", selection: $targetDate, displayedComponents: .date)
                        .listRowBackground(cardBgColor)
                    
                    Toggle("All-day (No specific time)", isOn: $allDay)
                        .listRowBackground(cardBgColor)
                    
                    if !allDay {
                        DatePicker("Start Time", selection: $startTime, displayedComponents: .hourAndMinute)
                            .listRowBackground(cardBgColor)
                        
                        Stepper("Duration: \(duration) mins", value: $duration, in: 15...480, step: 15)
                            .listRowBackground(cardBgColor)
                    }
                }
                
                Section(header: Text("Location & Notes (Optional)").foregroundColor(.gray)) {
                    TextField("Location", text: $location)
                        .listRowBackground(cardBgColor)
                    TextEditor(text: $notes)
                        .frame(height: 80)
                        .listRowBackground(cardBgColor)
                }
                
                Section {
                    Button(action: {
                        isSubmitting = true
                        
                        let dateF = DateFormatter()
                        dateF.dateFormat = "yyyy-MM-dd"
                        let dateStr = dateF.string(from: targetDate)
                        
                        let timeStr: String
                        let durVal: Int
                        if allDay {
                            timeStr = ""
                            durVal = 0
                        } else {
                            let timeF = DateFormatter()
                            timeF.dateFormat = "HH:mm:ss"
                            timeStr = timeF.string(from: startTime)
                            durVal = duration
                        }
                        
                        networkManager.logMissionItem(
                            itemName: itemName,
                            type: itemType,
                            calendar: calendarCat,
                            date: dateStr,
                            time: timeStr,
                            duration: durVal,
                            location: location,
                            notes: notes
                        ) { success in
                            DispatchQueue.main.async {
                                isSubmitting = false
                                if success {
                                    isPresented = false
                                } else {
                                    alertMsg = "Sync failed. Check your network connection and try again."
                                    showingAlert = true
                                }
                            }
                        }
                    }) {
                        HStack {
                            if isSubmitting {
                                ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .black))
                            } else {
                                Image(systemName: "cloud.upload.fill")
                                Text("Publish to Google Workspace")
                                    .fontWeight(.black)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .center)
                    }
                    .disabled(itemName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
                    .foregroundColor(itemName.isEmpty ? .gray : .black)
                    .listRowBackground(itemName.isEmpty ? Color.gray.opacity(0.2) : cyanColor)
                }
            }
            .background(bgColor.ignoresSafeArea())
            .navigationTitle("Log Task or Event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { isPresented = false }
                }
            }
            .alert(isPresented: $showingAlert) {
                Alert(title: Text("Sync Error"), message: Text(alertMsg), dismissButton: .default(Text("OK")))
            }
        }
        .preferredColorScheme(.dark)
    }
}

struct MissionItemRow: View {
    let item: MissionControlItem
    @ObservedObject var networkManager: NetworkManager
    let badgeColor: Color
    let cardBgColor: Color
    let cardBorderColor: Color
    let neonGreen: Color
    
    var body: some View {
        HStack(alignment: .top) {
            Button(action: {
                networkManager.toggleMissionItem(eventId: item.id, completed: !item.status)
            }) {
                Image(systemName: item.status ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(item.status ? neonGreen : .gray)
                    .font(.system(size: 20))
                    .padding(.top, 2)
            }
            
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(item.calendar.uppercased())
                        .font(.system(size: 8, weight: .bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(badgeColor)
                        .foregroundColor(.white)
                        .cornerRadius(4)
                    
                    Spacer()
                    
                    Text(item.type.lowercased() == "task" ? "☑️" : "📅")
                        .font(.system(size: 12))
                }
                
                Text(item.itemName)
                    .font(.system(size: 14, weight: .black, design: .rounded))
                    .foregroundColor(item.status ? .gray : .white)
                    .strikethrough(item.status)
                
                let dateDisplay = formatStringDate(item.date)
                let timeDisplay = item.time.isEmpty || item.time == "00:00:00" ? "All Day" : formatStringTime(item.time)
                let durSuffix = item.duration > 0 ? " (\(item.duration)m)" : ""
                
                Text("🕒 \(dateDisplay) @ \(timeDisplay)\(durSuffix)")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.gray)
                
                if !item.location.isEmpty {
                    Text("📍 \(item.location)")
                        .font(.system(size: 11))
                        .foregroundColor(.gray)
                }
                
                if !item.notes.isEmpty {
                    Text(item.notes)
                        .font(.system(size: 11))
                        .italic()
                        .foregroundColor(.gray.opacity(0.7))
                        .lineLimit(2)
                }
            }
            .padding(.leading, 4)
            
            Spacer()
            
            Button(action: {
                networkManager.deleteMissionItem(eventId: item.id)
            }) {
                Image(systemName: "trash")
                    .foregroundColor(.red.opacity(0.8))
                    .font(.system(size: 14))
            }
            .padding(.top, 2)
        }
        .padding()
        .background(cardBgColor)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
    }
    
    func formatStringDate(_ dateString: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        if let date = formatter.date(from: dateString) {
            let output = DateFormatter()
            output.dateFormat = "E, MMM d"
            return output.string(from: date)
        }
        return dateString
    }
    
    func formatStringTime(_ timeString: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        if let date = formatter.date(from: timeString) {
            let output = DateFormatter()
            output.dateFormat = "h:mm a"
            return output.string(from: date)
        }
        return timeString
    }
}

struct WebView: UIViewRepresentable {
    let urlString: String
    
    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.backgroundColor = .clear
        webView.isOpaque = false
        // Mimic Safari to bypass Google OAuth disallowed_useragent security checks in WebViews
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
        return webView
    }
    
    func updateUIView(_ uiView: WKWebView, context: Context) {
        if let url = URL(string: urlString) {
            let request = URLRequest(url: url)
            uiView.load(request)
        }
    }
}

