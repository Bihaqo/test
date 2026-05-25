import Foundation
import SwiftUI

struct WatchFaceView: View {
    @State private var now = Date()
    @State private var stopwatchStart: Date?
    @State private var elapsedBeforeStart: TimeInterval = 0
    @State private var lastLap: TimeInterval?

    private let timer = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()

    private var isRunning: Bool {
        stopwatchStart != nil
    }

    private var elapsed: TimeInterval {
        guard let stopwatchStart else {
            return elapsedBeforeStart
        }

        return elapsedBeforeStart + now.timeIntervalSince(stopwatchStart)
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.03, green: 0.04, blue: 0.05), Color(red: 0.05, green: 0.10, blue: 0.11)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 22) {
                header

                WatchDial(date: now)
                    .frame(width: 286, height: 286)
                    .padding(.top, 8)

                VStack(spacing: 6) {
                    Text(now, format: .dateTime.hour().minute().second())
                        .font(.system(size: 42, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.white)

                    Text(now, format: .dateTime.weekday(.wide).month(.wide).day().year())
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.66))
                }

                stopwatchPanel

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 22)
            .padding(.top, 18)
            .padding(.bottom, 26)
        }
        .onReceive(timer) { value in
            now = value
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("PulseWatch")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)

                Text("iPhone watch face")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.mint.opacity(0.78))
            }

            Spacer()

            Image(systemName: "iphone")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.mint)
                .frame(width: 48, height: 48)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }

    private var stopwatchPanel: some View {
        VStack(spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Stopwatch")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.72))

                    Text(formatDuration(elapsed))
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                }

                Spacer()

                if let lastLap {
                    VStack(alignment: .trailing, spacing: 5) {
                        Text("Lap")
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.52))

                        Text(formatDuration(lastLap))
                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(.mint)
                    }
                }
            }

            HStack(spacing: 10) {
                Button {
                    toggleStopwatch()
                } label: {
                    Label(isRunning ? "Pause" : "Start", systemImage: isRunning ? "pause.fill" : "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryControlStyle(tint: isRunning ? .orange : .mint))

                Button {
                    recordLapOrReset()
                } label: {
                    Label(isRunning ? "Lap" : "Reset", systemImage: isRunning ? "flag.fill" : "arrow.counterclockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryControlStyle(tint: .white.opacity(0.18)))
            }
        }
        .padding(16)
        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.white.opacity(0.10), lineWidth: 1)
        )
    }

    private func toggleStopwatch() {
        if let stopwatchStart {
            elapsedBeforeStart += now.timeIntervalSince(stopwatchStart)
            self.stopwatchStart = nil
        } else {
            stopwatchStart = now
        }
    }

    private func recordLapOrReset() {
        if isRunning {
            lastLap = elapsed
        } else {
            elapsedBeforeStart = 0
            lastLap = nil
        }
    }

    private func formatDuration(_ duration: TimeInterval) -> String {
        let centiseconds = Int((duration * 100).rounded(.down))
        let minutes = centiseconds / 6000
        let seconds = (centiseconds / 100) % 60
        let hundredths = centiseconds % 100

        return String(format: "%02d:%02d.%02d", minutes, seconds, hundredths)
    }
}

private struct WatchDial: View {
    let date: Date

    private var components: DateComponents {
        Calendar.current.dateComponents([.hour, .minute, .second], from: date)
    }

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let center = CGPoint(x: proxy.size.width / 2, y: proxy.size.height / 2)
            let radius = side / 2
            let hour = Double(components.hour ?? 0).truncatingRemainder(dividingBy: 12)
            let minute = Double(components.minute ?? 0)
            let second = Double(components.second ?? 0)

            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [.white.opacity(0.16), .black.opacity(0.25)],
                            center: .topLeading,
                            startRadius: 12,
                            endRadius: radius
                        )
                    )
                    .overlay(Circle().stroke(.white.opacity(0.12), lineWidth: 1))
                    .shadow(color: .black.opacity(0.42), radius: 28, y: 18)

                ForEach(0..<60, id: \.self) { tick in
                    Capsule()
                        .fill(tick.isMultiple(of: 5) ? .white.opacity(0.86) : .white.opacity(0.28))
                        .frame(width: tick.isMultiple(of: 5) ? 4 : 2, height: tick.isMultiple(of: 5) ? 17 : 8)
                        .offset(y: -radius + 20)
                        .rotationEffect(.degrees(Double(tick) * 6))
                }

                Hand(length: radius * 0.42, width: 7, color: .white.opacity(0.92))
                    .rotationEffect(.degrees(((hour + minute / 60) * 30) - 90))

                Hand(length: radius * 0.62, width: 5, color: .white.opacity(0.78))
                    .rotationEffect(.degrees(((minute + second / 60) * 6) - 90))

                Hand(length: radius * 0.70, width: 2, color: .mint)
                    .rotationEffect(.degrees((second * 6) - 90))

                Circle()
                    .fill(.mint)
                    .frame(width: 13, height: 13)
                    .position(center)
            }
        }
        .accessibilityLabel("Analog watch face")
    }
}

private struct Hand: View {
    let length: CGFloat
    let width: CGFloat
    let color: Color

    var body: some View {
        Capsule()
            .fill(color)
            .frame(width: length, height: width)
            .offset(x: length / 2)
    }
}

private struct PrimaryControlStyle: ButtonStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .padding(.vertical, 13)
            .background(tint.opacity(configuration.isPressed ? 0.58 : 0.78), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

#Preview {
    WatchFaceView()
}
