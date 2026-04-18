#!/usr/bin/env swift
// AI Gauge — macOS app icon renderer. Usage: swift generate-icon.swift <iconset-dir>
//
// Coordinate system trap: NSImage.lockFocus on macOS gives an UNFLIPPED y-up
// CGContext. In y-up, an arc with startAngle=π and endAngle=0 traces the
// visual TOP half only when clockwise=true (counter-intuitive vs iOS y-down).
// The gauge pivot sits at y=424 so it appears in the upper portion of the
// canvas even though 424 is below the midline numerically.

import AppKit
import CoreGraphics
import Foundation

let canvas: CGFloat = 1024

func renderIcon() -> NSImage {
    let size = NSSize(width: canvas, height: canvas)
    let img = NSImage(size: size)
    img.lockFocus()
    defer { img.unlockFocus() }

    guard let ctx = NSGraphicsContext.current?.cgContext else {
        FileHandle.standardError.write("No CGContext available\n".data(using: .utf8)!)
        exit(1)
    }

    let rgb = CGColorSpaceCreateDeviceRGB()
    func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
        return CGColor(colorSpace: rgb, components: [r/255, g/255, b/255, a])!
    }

    let cornerRadius: CGFloat = 224
    let bgRect = CGRect(x: 0, y: 0, width: canvas, height: canvas)
    let bgPath = CGPath(
        roundedRect: bgRect,
        cornerWidth: cornerRadius,
        cornerHeight: cornerRadius,
        transform: nil
    )

    let bgGradient = CGGradient(
        colorsSpace: rgb,
        colors: [color(43, 43, 53), color(26, 26, 34)] as CFArray,
        locations: [0, 1]
    )!

    ctx.saveGState()
    ctx.addPath(bgPath)
    ctx.clip()
    ctx.drawLinearGradient(
        bgGradient,
        start: CGPoint(x: canvas / 2, y: canvas),
        end: CGPoint(x: canvas / 2, y: 0),
        options: []
    )
    ctx.restoreGState()

    let centerX: CGFloat = canvas / 2
    let centerY: CGFloat = 424
    let radius: CGFloat = 320
    let arcWidth: CGFloat = 72

    ctx.saveGState()
    ctx.setLineWidth(arcWidth)
    ctx.setLineCap(.round)
    ctx.setStrokeColor(color(58, 58, 69))
    ctx.addArc(
        center: CGPoint(x: centerX, y: centerY),
        radius: radius,
        startAngle: .pi,
        endAngle: 0,
        clockwise: true
    )
    ctx.strokePath()
    ctx.restoreGState()

    let arcGradient = CGGradient(
        colorsSpace: rgb,
        colors: [color(255, 149, 0), color(255, 59, 48)] as CFArray,
        locations: [0, 1]
    )!

    let fillSweep: CGFloat = 0.75 * .pi
    let fillEndAngle: CGFloat = .pi - fillSweep

    let fillArcPath = CGMutablePath()
    fillArcPath.addArc(
        center: CGPoint(x: centerX, y: centerY),
        radius: radius,
        startAngle: .pi,
        endAngle: fillEndAngle,
        clockwise: true
    )

    ctx.saveGState()
    ctx.setLineWidth(arcWidth)
    ctx.setLineCap(.round)
    ctx.addPath(fillArcPath)
    ctx.replacePathWithStrokedPath()
    ctx.clip()
    ctx.drawLinearGradient(
        arcGradient,
        start: CGPoint(x: centerX - radius, y: centerY),
        end: CGPoint(x: centerX + radius, y: centerY),
        options: []
    )
    ctx.restoreGState()

    ctx.saveGState()
    ctx.setStrokeColor(color(140, 140, 150, 0.4))
    ctx.setLineWidth(4)
    ctx.setLineCap(.round)
    let tickInner = radius + arcWidth / 2 + 18
    let tickOuter = tickInner + 20
    let tickCount = 6
    for i in 0...tickCount {
        let t = CGFloat(i) / CGFloat(tickCount)
        let ang: CGFloat = .pi - (t * .pi)
        let p1 = CGPoint(x: centerX + cos(ang) * tickInner, y: centerY + sin(ang) * tickInner)
        let p2 = CGPoint(x: centerX + cos(ang) * tickOuter, y: centerY + sin(ang) * tickOuter)
        ctx.move(to: p1)
        ctx.addLine(to: p2)
        ctx.strokePath()
    }
    ctx.restoreGState()

    let needleAngle: CGFloat = .pi - (0.7 * .pi)
    let needleLength: CGFloat = 280
    let needleBaseHalf: CGFloat = 5
    let needleTipHalf: CGFloat = 1

    let cosA = cos(needleAngle)
    let sinA = sin(needleAngle)
    let perpX = -sinA
    let perpY = cosA

    let tipX = centerX + cosA * needleLength
    let tipY = centerY + sinA * needleLength

    let needlePath = CGMutablePath()
    needlePath.move(to: CGPoint(
        x: centerX + perpX * needleBaseHalf,
        y: centerY + perpY * needleBaseHalf
    ))
    needlePath.addLine(to: CGPoint(
        x: tipX + perpX * needleTipHalf,
        y: tipY + perpY * needleTipHalf
    ))
    needlePath.addLine(to: CGPoint(
        x: tipX - perpX * needleTipHalf,
        y: tipY - perpY * needleTipHalf
    ))
    needlePath.addLine(to: CGPoint(
        x: centerX - perpX * needleBaseHalf,
        y: centerY - perpY * needleBaseHalf
    ))
    needlePath.closeSubpath()

    ctx.saveGState()
    ctx.setFillColor(color(255, 255, 255))
    ctx.addPath(needlePath)
    ctx.fillPath()
    ctx.restoreGState()

    // 6. Center hub — dark circle covering the needle base, with a hairline highlight
    ctx.saveGState()
    let hubRect = CGRect(x: centerX - 24, y: centerY - 24, width: 48, height: 48)
    ctx.setFillColor(color(26, 26, 34))
    ctx.addEllipse(in: hubRect)
    ctx.fillPath()
    ctx.setStrokeColor(color(255, 255, 255, 0.15))
    ctx.setLineWidth(2)
    ctx.addEllipse(in: hubRect)
    ctx.strokePath()
    ctx.restoreGState()

    return img
}

func writePNG(_ image: NSImage, size: CGFloat, to path: String) {
    let target = NSSize(width: size, height: size)
    let scaled = NSImage(size: target)
    scaled.lockFocus()
    NSGraphicsContext.current?.imageInterpolation = .high
    image.draw(
        in: NSRect(origin: .zero, size: target),
        from: NSRect(origin: .zero, size: image.size),
        operation: .copy,
        fraction: 1.0
    )
    scaled.unlockFocus()

    guard
        let tiff = scaled.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff),
        let png = rep.representation(using: .png, properties: [:])
    else {
        FileHandle.standardError.write("Failed to encode \(path)\n".data(using: .utf8)!)
        return
    }

    do {
        try png.write(to: URL(fileURLWithPath: path))
        print("→ \(path) (\(Int(size))px)")
    } catch {
        FileHandle.standardError.write("Failed to write \(path): \(error)\n".data(using: .utf8)!)
    }
}

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write("Usage: generate-icon.swift <iconset-dir>\n".data(using: .utf8)!)
    exit(1)
}

let iconsetDir = CommandLine.arguments[1]
do {
    try FileManager.default.createDirectory(
        atPath: iconsetDir,
        withIntermediateDirectories: true
    )
} catch {
    FileHandle.standardError.write("Failed to create \(iconsetDir): \(error)\n".data(using: .utf8)!)
    exit(1)
}

let master = renderIcon()

let variants: [(name: String, px: CGFloat)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

for (name, px) in variants {
    writePNG(master, size: px, to: "\(iconsetDir)/\(name)")
}

print("Generated \(variants.count) PNG variants in \(iconsetDir)")
