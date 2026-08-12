import Foundation

class GeminiManager: ObservableObject {
    static let shared = GeminiManager()
    
    private let baseURL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
    
    // MARK: - Daily Journal Photo Highlights
    func highlightPhotos(imagesBase64: [String], completion: @escaping ([Int]?) -> Void) {
        guard !Secrets.geminiAPIKey.isEmpty else {
            completion(nil)
            return
        }
        
        let url = URL(string: "\(baseURL)?key=\(Secrets.geminiAPIKey)")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let promptText = "Here are \(imagesBase64.count) photos from a user's day. Select up to 4 that are the most visually beautiful or meaningful to highlight the day. Ignore receipts, screenshots, blur, and text. Return ONLY a JSON list of the integer indices of the chosen photos, starting from 0 (e.g. [0, 5, 12])."
        
        var parts: [[String: Any]] = [["text": promptText]]
        for imgBase64 in imagesBase64 {
            let imgPart: [String: Any] = [
                "inlineData": [
                    "mimeType": "image/jpeg",
                    "data": imgBase64
                ]
            ]
            parts.append(imgPart)
        }
        
        let body: [String: Any] = [
            "contents": [
                [
                    "parts": parts
                ]
            ]
        ]
        
        request.httpBody = try? JSONSerialization.data(withJSONObject: body, options: [])
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            guard let data = data, error == nil else {
                DispatchQueue.main.async { completion(nil) }
                return
            }
            
            do {
                if let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
                   let candidates = json["candidates"] as? [[String: Any]],
                   let firstCandidate = candidates.first,
                   let content = firstCandidate["content"] as? [String: Any],
                   let parts = content["parts"] as? [[String: Any]],
                   let text = parts.first?["text"] as? String {
                    
                    // Parse text like "```json\n[0, 2, 5]\n```"
                    var cleanText = text.replacingOccurrences(of: "```json", with: "").replacingOccurrences(of: "```", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                    
                    if let parsedData = cleanText.data(using: .utf8),
                       let indices = try JSONSerialization.jsonObject(with: parsedData, options: []) as? [Int] {
                        DispatchQueue.main.async { completion(indices) }
                        return
                    }
                }
                DispatchQueue.main.async { completion(nil) }
            } catch {
                DispatchQueue.main.async { completion(nil) }
            }
        }.resume()
    }
    
    // MARK: - AI Scheduler
    func generateSchedule(tasks: [String], events: [String], completion: @escaping (String?) -> Void) {
        guard !Secrets.geminiAPIKey.isEmpty else {
            completion(nil)
            return
        }
        
        let url = URL(string: "\(baseURL)?key=\(Secrets.geminiAPIKey)")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let promptText = """
        You are an elite productivity assistant. Given a list of tasks and calendar events, create an optimized hourly schedule for today.
        
        Tasks:
        \(tasks.joined(separator: "\n"))
        
        Events:
        \(events.joined(separator: "\n"))
        
        Output a detailed markdown timeline starting from right now. Be realistic about time.
        """
        
        let body: [String: Any] = [
            "contents": [
                [
                    "parts": [
                        ["text": promptText]
                    ]
                ]
            ]
        ]
        
        request.httpBody = try? JSONSerialization.data(withJSONObject: body, options: [])
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            guard let data = data, error == nil else {
                DispatchQueue.main.async { completion(nil) }
                return
            }
            
            do {
                if let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
                   let candidates = json["candidates"] as? [[String: Any]],
                   let firstCandidate = candidates.first,
                   let content = firstCandidate["content"] as? [String: Any],
                   let parts = content["parts"] as? [[String: Any]],
                   let text = parts.first?["text"] as? String {
                    
                    DispatchQueue.main.async { completion(text) }
                } else {
                    DispatchQueue.main.async { completion(nil) }
                }
            } catch {
                DispatchQueue.main.async { completion(nil) }
            }
        }.resume()
    }
}
