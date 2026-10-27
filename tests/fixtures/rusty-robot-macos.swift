// Owned AppKit target. All input comes through the OS; stdin only reads state.
import AppKit
import Foundation

func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}

final class Target: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let editor = NSTextView(frame: NSRect(x: 20, y: 20, width: 660, height: 350))
    let button = NSButton(title: "Native button", target: nil, action: nil)
    let status = NSTextField(labelWithString: "Rusty Robot · AppKit verification")
    var clicks = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        // AppKit routes standard Command shortcuts through the application's
        // Edit menu. Match a normal Cocoa editor's responder-chain actions.
        let menu = NSMenu()
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let edit = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"),
                                     ("Select All", "selectAll:", "a")] {
            edit.addItem(NSMenuItem(title: title, action: NSSelectorFromString(action), keyEquivalent: key))
        }
        editItem.submenu = edit
        menu.addItem(editItem)
        NSApplication.shared.mainMenu = menu
        let screen = NSScreen.screens[0].frame
        window = NSWindow(contentRect: NSRect(x: 100, y: screen.maxY - 600, width: 700, height: 500),
                          styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Rusty Robot owned native test window"
        window.isReleasedWhenClosed = false
        window.level = .floating
        editor.font = NSFont.systemFont(ofSize: 18)
        editor.isRichText = false
        editor.allowsUndo = true
        editor.isAutomaticQuoteSubstitutionEnabled = false
        editor.isAutomaticDashSubstitutionEnabled = false
        editor.isAutomaticTextReplacementEnabled = false
        editor.isAutomaticSpellingCorrectionEnabled = false
        editor.autoresizingMask = [.width, .height]
        button.frame = NSRect(x: 20, y: 400, width: 180, height: 40)
        button.bezelStyle = .rounded
        button.target = self
        button.action = #selector(clicked)
        status.frame = NSRect(x: 20, y: 455, width: 660, height: 24)
        for view in [editor, button, status] as [NSView] { window.contentView!.addSubview(view) }
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeFirstResponder(editor)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            emit(["ready": true, "window": self.screenRect(self.window.contentView!),
                  "editor": self.screenRect(self.editor), "button": self.screenRect(self.button)])
        }
        DispatchQueue.global().async {
            while let line = readLine() {
                DispatchQueue.main.async {
                    guard let data = line.data(using: .utf8),
                          let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                    else { return }
                    if let phase = command["phase"] as? String { self.status.stringValue = phase }
                    emit(["text": self.editor.string, "clicks": self.clicks,
                          "active": NSApplication.shared.isActive,
                          "selectionLength": self.editor.selectedRange().length])
                }
            }
            DispatchQueue.main.async { NSApplication.shared.terminate(nil) }
        }
    }
    func screenRect(_ view: NSView) -> [String: Int] {
        let rect = window.convertToScreen(view.convert(view.bounds, to: nil))
        return ["x": Int(rect.minX), "y": Int(NSScreen.screens[0].frame.maxY - rect.maxY),
                "width": Int(rect.width), "height": Int(rect.height)]
    }
    @objc func clicked() { clicks += 1; status.stringValue = "Native button clicks: \(clicks)" }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let target = Target()
app.delegate = target
app.run()
