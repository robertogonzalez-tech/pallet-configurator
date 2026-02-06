#!/usr/bin/env python3
"""
Fix GLB model orientation for Three.js/WebGL
Target: Y-up, with height (smallest dim) along Y, length/width along X/Z
"""

import trimesh
import numpy as np
import sys
import os

def analyze_and_fix(input_path, output_path):
    """Load GLB, analyze orientation, apply correct rotation"""
    
    print(f"  Loading {os.path.basename(input_path)}...")
    scene = trimesh.load(input_path, force='scene')
    
    # Get bounds 
    bounds = scene.bounds
    size = bounds[1] - bounds[0]
    print(f"  Original size: X={size[0]:.1f}mm, Y={size[1]:.1f}mm, Z={size[2]:.1f}mm")
    print(f"  In inches:     X={size[0]/25.4:.1f}\", Y={size[1]/25.4:.1f}\", Z={size[2]/25.4:.1f}\"")
    
    # For DD slides: expect ~80" x 16.5" x 6.5"
    # Height (6.5") should end up as Y
    # Find which axis currently has the smallest dimension (that's our height)
    min_idx = np.argmin(size)
    max_idx = np.argmax(size)
    axes = ['X', 'Y', 'Z']
    
    print(f"  Smallest (height): {axes[min_idx]} = {size[min_idx]/25.4:.1f}\"")
    print(f"  Largest (length):  {axes[max_idx]} = {size[max_idx]/25.4:.1f}\"")
    
    # Determine rotation needed to put smallest dimension on Y
    rotation_matrix = np.eye(4)
    
    if min_idx == 0:  # Height is on X, need to rotate to Y
        # Rotate +90° around Z axis: X→Y, Y→-X
        print(f"  Rotating +90° around Z to move height from X to Y")
        rotation_matrix = trimesh.transformations.rotation_matrix(np.pi/2, [0, 0, 1])
    elif min_idx == 1:  # Height already on Y
        print(f"  Height already on Y axis - no rotation needed")
    elif min_idx == 2:  # Height is on Z, need to rotate to Y
        # Rotate +90° around X axis: Z→Y, Y→-Z  
        print(f"  Rotating +90° around X to move height from Z to Y")
        rotation_matrix = trimesh.transformations.rotation_matrix(np.pi/2, [1, 0, 0])
    
    # Apply rotation
    scene.apply_transform(rotation_matrix)
    
    # Get new bounds
    new_bounds = scene.bounds
    new_size = new_bounds[1] - new_bounds[0]
    print(f"  New size:      X={new_size[0]:.1f}mm, Y={new_size[1]:.1f}mm, Z={new_size[2]:.1f}mm")
    print(f"  In inches:     X={new_size[0]/25.4:.1f}\", Y={new_size[1]/25.4:.1f}\", Z={new_size[2]/25.4:.1f}\"")
    
    # Verify Y is now the smallest
    if np.argmin(new_size) == 1:
        print(f"  ✅ Height now correctly on Y axis")
    else:
        print(f"  ⚠️ Warning: Y is not the smallest dimension")
    
    # Export
    print(f"  Saving to {os.path.basename(output_path)}...")
    scene.export(output_path, file_type='glb')
    print(f"  ✅ Done!")

def main():
    if len(sys.argv) < 3:
        print("Usage: python fix-glb-orientation.py <input.glb> <output.glb>")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    
    if not os.path.exists(input_path):
        print(f"Error: File not found: {input_path}")
        sys.exit(1)
    
    analyze_and_fix(input_path, output_path)

if __name__ == "__main__":
    main()
