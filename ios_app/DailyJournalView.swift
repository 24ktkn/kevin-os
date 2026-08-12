import SwiftUI
import MapKit

struct DailyJournalView: View {
    @ObservedObject var networkManager: NetworkManager
    @ObservedObject var locationManager: LocationManager
    
    let bgColor = Color(red: 0.06, green: 0.06, blue: 0.07)
    let cardBgColor = Color(red: 0.09, green: 0.09, blue: 0.11)
    let cardBorderColor = Color(red: 0.14, green: 0.14, blue: 0.18)
    let neonGreen = Color(red: 0.0, green: 1.0, blue: 0.4)
    
    @State private var journalText = ""
    @State private var photoURLs: [String] = []
    @State private var highlightedIndices: [Int] = []
    @State private var isLoadingPhotos = false
    
    // Map state
    @State private var region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
        span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
    )
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                
                // Header
                HStack {
                    VStack(alignment: .leading) {
                        Text("📔 Daily Journal")
                            .font(.system(size: 28, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                        Text(networkManager.dateStr)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundColor(.gray)
                    }
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.top, 8)
                
                // Biometrics Summary
                VStack(alignment: .leading, spacing: 8) {
                    Text("Daily Summary")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    let wCal = networkManager.biometrics.workoutCalories ?? 0.0
                    let wDur = networkManager.biometrics.workoutDuration ?? 0.0
                    
                    VStack(spacing: 16) {
                        HStack {
                            VStack {
                                Text("\(networkManager.biometrics.steps)")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundColor(neonGreen)
                                Text("Steps").font(.system(size: 10)).foregroundColor(.gray)
                            }
                            Spacer()
                            VStack {
                                Text(String(format: "%.1fh", networkManager.biometrics.sleep))
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundColor(.white)
                                Text("Sleep").font(.system(size: 10)).foregroundColor(.gray)
                            }
                            Spacer()
                            VStack {
                                Text("\(networkManager.biometrics.hrv)")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundColor(.white)
                                Text("HRV").font(.system(size: 10)).foregroundColor(.gray)
                            }
                        }
                        HStack {
                            VStack {
                                Text("\(networkManager.biometrics.rhr)")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundColor(.white)
                                Text("RHR").font(.system(size: 10)).foregroundColor(.gray)
                            }
                            Spacer()
                            VStack {
                                Text("\(Int(wCal))")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundColor(.orange)
                                Text("Workout Kcal").font(.system(size: 10)).foregroundColor(.gray)
                            }
                            Spacer()
                            VStack {
                                Text("\(Int(wDur))m")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundColor(.blue)
                                Text("Workout Min").font(.system(size: 10)).foregroundColor(.gray)
                            }
                        }
                    }
                    .padding()
                    .background(cardBgColor)
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                }
                .padding(.horizontal)
                
                // Map Trajectory (Just a placeholder box for now if LocationManager doesn't expose MKPolyline easily)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Movement Trajectory")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    if #available(iOS 14.0, *) {
                        Map(coordinateRegion: $region, interactionModes: .all, showsUserLocation: true, userTrackingMode: .constant(.follow))
                            .frame(height: 200)
                            .cornerRadius(12)
                    } else {
                        Map(coordinateRegion: $region, showsUserLocation: true)
                            .frame(height: 200)
                            .cornerRadius(12)
                            .onAppear {
                                if let loc = locationManager.location {
                                    region = MKCoordinateRegion(center: loc.coordinate, span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02))
                                }
                            }
                            .onChange(of: locationManager.location) { newLocation in
                                if let loc = newLocation {
                                    region = MKCoordinateRegion(center: loc.coordinate, span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02))
                                }
                            }
                    }
                }
                .padding(.horizontal)
                
                // Timeline / Activities
                let todaysWorkouts = networkManager.recentWorkouts.filter { $0.date == networkManager.dateStr }
                
                VStack(alignment: .leading, spacing: 8) {
                    Text("Today's Timeline")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    if todaysWorkouts.isEmpty {
                        Text("No activities recorded yet today.")
                            .font(.system(size: 14))
                            .foregroundColor(.gray)
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(cardBgColor)
                            .cornerRadius(12)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                    } else {
                        VStack(spacing: 0) {
                            ForEach(todaysWorkouts) { set in
                                HStack(alignment: .top, spacing: 12) {
                                    // Timeline dot
                                    VStack(spacing: 0) {
                                        Circle()
                                            .fill(Color.orange)
                                            .frame(width: 10, height: 10)
                                            .padding(.top, 4)
                                        
                                        if set.id != todaysWorkouts.last?.id {
                                            Rectangle()
                                                .fill(Color.gray.opacity(0.3))
                                                .frame(width: 2)
                                                .padding(.vertical, 2)
                                        }
                                    }
                                    
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("Set \(set.setNumber)")
                                            .font(.system(size: 12, weight: .bold))
                                            .foregroundColor(.orange)
                                        
                                        Text(set.exercise)
                                            .font(.system(size: 14, weight: .bold))
                                            .foregroundColor(.white)
                                        
                                        if set.weight > 0 {
                                            Text("\(Int(set.weight)) lbs x \(set.reps) reps")
                                                .font(.system(size: 14))
                                                .foregroundColor(.gray)
                                        } else if set.duration > 0 {
                                            Text("\(Int(set.duration)) minutes")
                                                .font(.system(size: 14))
                                                .foregroundColor(.gray)
                                        }
                                    }
                                    Spacer()
                                }
                                .padding(.vertical, 8)
                            }
                        }
                        .padding(12)
                        .background(cardBgColor)
                        .cornerRadius(12)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(cardBorderColor, lineWidth: 1))
                    }
                }
                .padding(.horizontal)
                
                // Manual Journal
                VStack(alignment: .leading, spacing: 8) {
                    Text("Reflect on your day")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    TextEditor(text: $journalText)
                        .frame(height: 150)
                        .padding(8)
                        .background(Color.white.opacity(0.05))
                        .cornerRadius(8)
                        .foregroundColor(.white)
                    
                    Button(action: {
                        // In a full implementation, you would post this to the Apps Script
                        print("Saved Journal: \(journalText)")
                    }) {
                        Text("Save Journal Entry")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.black)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(neonGreen)
                            .cornerRadius(12)
                    }
                }
                .padding(.horizontal)
                
                // Photos
                VStack(alignment: .leading, spacing: 8) {
                    Text("Daily Photos")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.gray)
                        .textCase(.uppercase)
                    
                    Button(action: {
                        fetchAndHighlightPhotos()
                    }) {
                        Text("✨ Sync & Highlight Best Photos")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue.opacity(0.3))
                            .cornerRadius(12)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.blue, lineWidth: 1))
                    }
                    
                    if isLoadingPhotos {
                        ProgressView().padding()
                    } else if !highlightedIndices.isEmpty {
                        Text("AI Highlights")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.top)
                        
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                            ForEach(highlightedIndices, id: \.self) { idx in
                                if idx < photoURLs.count {
                                    AsyncImage(url: URL(string: photoURLs[idx])) { phase in
                                        if let image = phase.image {
                                            image.resizable().aspectRatio(contentMode: .fill).frame(height: 150).clipped().cornerRadius(8)
                                        } else {
                                            Color.gray.frame(height: 150).cornerRadius(8)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal)
                
                Spacer(minLength: 50)
            }
        }
        .background(bgColor.ignoresSafeArea())
    }
    
    private func fetchAndHighlightPhotos() {
        isLoadingPhotos = true
        GoogleAuthManager.shared.getValidAccessToken { token in
            guard let token = token else {
                isLoadingPhotos = false
                return
            }
            
            let url = URL(string: "https://photoslibrary.googleapis.com/v1/mediaItems:search")!
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            
            let calendar = Calendar.current
            let components = calendar.dateComponents([.year, .month, .day], from: Date()) // Fetch for today
            
            let body: [String: Any] = [
                "filters": [
                    "dateFilter": [
                        "dates": [["year": components.year!, "month": components.month!, "day": components.day!]]
                    ],
                    "mediaTypeFilter": [
                        "mediaTypes": ["PHOTO"]
                    ]
                ],
                "pageSize": 20
            ]
            
            request.httpBody = try? JSONSerialization.data(withJSONObject: body, options: [])
            
            URLSession.shared.dataTask(with: request) { data, response, error in
                guard let data = data, let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
                      let mediaItems = json["mediaItems"] as? [[String: Any]] else {
                    DispatchQueue.main.async { isLoadingPhotos = false }
                    return
                }
                
                var base64Images: [String] = []
                var urls: [String] = []
                
                let group = DispatchGroup()
                
                for item in mediaItems.prefix(10) {
                    if let baseUrl = item["baseUrl"] as? String {
                        let fetchUrl = baseUrl + "=w400-h400-c"
                        urls.append(fetchUrl)
                        group.enter()
                        URLSession.shared.dataTask(with: URL(string: fetchUrl)!) { imgData, _, _ in
                            if let imgData = imgData {
                                base64Images.append(imgData.base64EncodedString())
                            }
                            group.leave()
                        }.resume()
                    }
                }
                
                group.notify(queue: .main) {
                    self.photoURLs = urls
                    
                    if !base64Images.isEmpty {
                        GeminiManager.shared.highlightPhotos(imagesBase64: base64Images) { indices in
                            self.isLoadingPhotos = false
                            if let indices = indices {
                                self.highlightedIndices = indices
                            }
                        }
                    } else {
                        self.isLoadingPhotos = false
                    }
                }
            }.resume()
        }
    }
}
