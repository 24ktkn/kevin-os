import Foundation
import HealthKit
import Combine

class HealthManager: ObservableObject {
    let healthStore = HKHealthStore()
    
    // Use your Apps Script Web App URL here
    let apiURLString = "https://script.google.com/macros/s/AKfycbzlQKBy3jyOv3SqhV-iqwtCQBoP7Ry-uAhTpbTJE0FhU0mZKG-KX0UlR-BB2VrVYrx5Xg/exec"
    
    // Define the data types we want to read
    let stepCountType = HKObjectType.quantityType(forIdentifier: .stepCount)!
    let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate)!
    let restingHeartRateType = HKObjectType.quantityType(forIdentifier: .restingHeartRate)!
    let hrvType = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!
    let weightType = HKObjectType.quantityType(forIdentifier: .bodyMass)!
    let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!
    let workoutType = HKObjectType.workoutType()
    
    func requestPermissions(completion: @escaping (Bool) -> Void) {
        guard HKHealthStore.isHealthDataAvailable() else {
            completion(false)
            return
        }
        
        let typesToRead: Set<HKObjectType> = [
            stepCountType,
            heartRateType,
            restingHeartRateType,
            hrvType,
            weightType,
            sleepType,
            workoutType
        ]
        
        healthStore.requestAuthorization(toShare: nil, read: typesToRead) { success, error in
            if let error = error {
                print("HealthKit Authorization Error: \(error.localizedDescription)")
            }
            completion(success)
        }
    }
    
    // MARK: - Background Observer Queries
    
    func setupBackgroundObservers() {
        // Observe steps, sleep, and workouts
        setupObserver(for: stepCountType)
        setupObserver(for: sleepType)
        setupObserver(for: workoutType)
    }
    
    private func setupObserver(for type: HKSampleType) {
        // We use HKObserverQuery to get notified when new data is added (even in background)
        let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] query, completionHandler, error in
            if let error = error {
                print("Observer query error for \(type.identifier): \(error.localizedDescription)")
                return
            }
            
            // When notified, fetch the latest day's data and sync it
            self?.syncTodayHealthData() {
                // Must call completionHandler to tell iOS we're done processing the background event
                completionHandler()
            }
        }
        
        healthStore.execute(query)
        
        // Enable background delivery
        healthStore.enableBackgroundDelivery(for: type, frequency: .hourly) { success, error in
            if let error = error {
                print("Error enabling background delivery for \(type.identifier): \(error.localizedDescription)")
            }
        }
    }
    
    // MARK: - Data Fetching
    
    func syncTodayHealthData(completion: (() -> Void)? = nil) {
        let dispatchGroup = DispatchGroup()
        
        var totalSteps = 0
        var avgRHR = 0
        var avgHRV = 0
        var latestWeight = 0.0
        var sleepDurationHours = 0.0
        var workoutCalories = 0.0
        var workoutDuration = 0.0
        
        // 1. Fetch Steps
        dispatchGroup.enter()
        fetchTotalStepsToday { steps in
            totalSteps = steps
            dispatchGroup.leave()
        }
        
        // 2. Fetch RHR
        dispatchGroup.enter()
        fetchLatestQuantity(for: restingHeartRateType, unit: HKUnit(from: "count/min")) { value in
            avgRHR = Int(value)
            dispatchGroup.leave()
        }
        
        // 3. Fetch HRV
        dispatchGroup.enter()
        fetchLatestQuantity(for: hrvType, unit: HKUnit(from: "ms")) { value in
            avgHRV = Int(value)
            dispatchGroup.leave()
        }
        
        // 4. Fetch Weight
        dispatchGroup.enter()
        fetchLatestQuantity(for: weightType, unit: HKUnit.pound()) { value in
            latestWeight = value
            dispatchGroup.leave()
        }
        
        // 5. Fetch Sleep
        dispatchGroup.enter()
        fetchSleepLastNight { duration, wakeTime, sleepTime in
            sleepDurationHours = duration
            dispatchGroup.leave()
        }
        
        // 6. Fetch Workouts
        dispatchGroup.enter()
        fetchTodayWorkouts { calories, duration in
            workoutCalories = calories
            workoutDuration = duration
            dispatchGroup.leave()
        }
        
        // When all fetches are complete, send to Apps Script
        dispatchGroup.notify(queue: .main) {
            self.pushMetricsToBackend(
                steps: totalSteps,
                rhr: avgRHR,
                hrv: avgHRV,
                weight: latestWeight,
                sleep: sleepDurationHours,
                workoutCalories: workoutCalories,
                workoutDuration: workoutDuration
            )
            completion?()
        }
    }
    
    private func fetchTotalStepsToday(completion: @escaping (Int) -> Void) {
        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date())
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: Date(), options: .strictStartDate)
        
        let query = HKStatisticsQuery(quantityType: stepCountType, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, result, _ in
            var steps = 0
            if let sum = result?.sumQuantity() {
                steps = Int(sum.doubleValue(for: HKUnit.count()))
            }
            completion(steps)
        }
        healthStore.execute(query)
    }
    
    private func fetchLatestQuantity(for type: HKQuantityType, unit: HKUnit, completion: @escaping (Double) -> Void) {
        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date())
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: Date(), options: .strictStartDate)
        
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: 1, sortDescriptors: [sortDescriptor]) { _, samples, _ in
            var value = 0.0
            if let sample = samples?.first as? HKQuantitySample {
                value = sample.quantity.doubleValue(for: unit)
            }
            completion(value)
        }
        healthStore.execute(query)
    }
    
    private func fetchSleepLastNight(completion: @escaping (Double, Date?, Date?) -> Void) {
        let calendar = Calendar.current
        // Look back up to 24 hours
        let endDate = Date()
        guard let startDate = calendar.date(byAdding: .hour, value: -24, to: endDate) else {
            completion(0, nil, nil)
            return
        }
        
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictEndDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)
        
        let query = HKSampleQuery(sampleType: sleepType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { _, samples, _ in
            guard let sleepSamples = samples as? [HKCategorySample] else {
                completion(0, nil, nil)
                return
            }
            
            // Filter for actual sleep stages (Core, Deep, REM, Unspecified) to calculate duration accurately on iOS 16+
            let validSamples = sleepSamples.filter { 
                $0.value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue ||
                $0.value == HKCategoryValueSleepAnalysis.asleepCore.rawValue ||
                $0.value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue ||
                $0.value == HKCategoryValueSleepAnalysis.asleepREM.rawValue
            }
            
            let totalSeconds = validSamples.reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }
            
            let sleepTime = validSamples.first?.startDate
            let wakeTime = validSamples.last?.endDate
            
            completion(totalSeconds / 3600.0, wakeTime, sleepTime)
        }
        healthStore.execute(query)
    }
    
    // MARK: - Workouts
    private func fetchTodayWorkouts(completion: @escaping (Double, Double) -> Void) {
        let calendar = Calendar.current
        let now = Date()
        let startOfDay = calendar.startOfDay(for: now)
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: now, options: .strictStartDate)
        
        let query = HKSampleQuery(sampleType: workoutType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
            guard let workouts = samples as? [HKWorkout], error == nil else {
                completion(0.0, 0.0)
                return
            }
            
            var totalCalories = 0.0
            var totalDurationMinutes = 0.0
            
            for workout in workouts {
                totalDurationMinutes += workout.duration / 60.0
                if let energy = workout.totalEnergyBurned {
                    totalCalories += energy.doubleValue(for: HKUnit.kilocalorie())
                }
            }
            
            completion(totalCalories, totalDurationMinutes)
        }
        
        healthStore.execute(query)
    }
    
    // MARK: - Backend Push
    
    private func pushMetricsToBackend(steps: Int, rhr: Int, hrv: Int, weight: Double, sleep: Double, workoutCalories: Double, workoutDuration: Double) {
        guard let url = URL(string: apiURLString) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "action": "upload_biometrics",
            "steps": steps,
            "rhr": rhr,
            "hrv": hrv,
            "weight": weight,
            "sleep": sleep,
            "workoutCalories": workoutCalories,
            "workoutDuration": workoutDuration
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        } catch {
            print("Payload serialization error: \(error)")
            return
        }
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("Error uploading biometrics: \(error.localizedDescription)")
                return
            }
            print("Successfully uploaded background biometrics to Kevin-OS!")
        }.resume()
    }
}
