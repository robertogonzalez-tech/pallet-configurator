import { Canvas, useLoader, useFrame } from '@react-three/fiber'
import { OrbitControls, Center, PerspectiveCamera } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { Suspense, useRef, useState, useMemo } from 'react'
import * as THREE from 'three'

function OBJModel({ url, color = '#1e40af', wireframe = false }) {
  const obj = useLoader(OBJLoader, url)
  const ref = useRef()
  const [hovered, setHovered] = useState(false)
  
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y += 0.002
    }
  })
  
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = new THREE.MeshStandardMaterial({
        color: hovered ? '#3b82f6' : color,
        metalness: 0.3,
        roughness: 0.6,
        wireframe: wireframe,
        side: THREE.DoubleSide
      })
    }
  })

  return (
    <primitive 
      ref={ref}
      object={obj} 
      scale={0.05}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    />
  )
}

function GLBModel({ url, color = '#1e40af', wireframe = false }) {
  const gltf = useLoader(GLTFLoader, url)
  const ref = useRef()
  const [hovered, setHovered] = useState(false)
  
  // Clone the scene to avoid mutation issues
  const scene = useMemo(() => {
    const clone = gltf.scene.clone()
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: hovered ? '#3b82f6' : color,
          metalness: 0.3,
          roughness: 0.6,
          wireframe: wireframe,
          side: THREE.DoubleSide
        })
      }
    })
    return clone
  }, [gltf, hovered, color, wireframe])
  
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y += 0.002
    }
  })

  return (
    <primitive 
      ref={ref}
      object={scene}
      scale={0.03}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    />
  )
}

function Model({ url, color = '#1e40af', wireframe = false }) {
  const isGLB = url.toLowerCase().endsWith('.glb') || url.toLowerCase().endsWith('.gltf')
  
  if (isGLB) {
    return <GLBModel url={url} color={color} wireframe={wireframe} />
  }
  return <OBJModel url={url} color={color} wireframe={wireframe} />
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#6b7280" wireframe />
    </mesh>
  )
}

export default function ModelViewer({ 
  modelUrl = '/models/DD04.obj', 
  height = 400,
  title = null 
}) {
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(true)
  
  return (
    <div style={{ 
      width: '100%', 
      height: `${height}px`, 
      background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
      borderRadius: '8px',
      overflow: 'hidden',
      position: 'relative'
    }}>
      {title && (
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          color: 'white',
          fontSize: '0.875rem',
          fontWeight: '600',
          background: 'rgba(0,0,0,0.5)',
          padding: '4px 10px',
          borderRadius: '4px',
          zIndex: 10
        }}>
          {title}
        </div>
      )}
      
      <Canvas>
        <PerspectiveCamera makeDefault position={[5, 3, 5]} fov={50} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <directionalLight position={[-10, -10, -5]} intensity={0.3} />
        <pointLight position={[0, 10, 0]} intensity={0.5} />
        
        <Suspense fallback={<LoadingFallback />}>
          <Center>
            <Model url={modelUrl} wireframe={wireframe} />
          </Center>
        </Suspense>
        
        <OrbitControls 
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          autoRotate={autoRotate}
          autoRotateSpeed={1}
        />
        
        <gridHelper args={[20, 20, '#374151', '#1f2937']} />
      </Canvas>
      
      {/* Controls overlay */}
      <div style={{
        position: 'absolute',
        bottom: '12px',
        left: '12px',
        display: 'flex',
        gap: '8px'
      }}>
        <button
          onClick={() => setWireframe(!wireframe)}
          style={{
            padding: '6px 12px',
            background: wireframe ? '#3b82f6' : 'rgba(255,255,255,0.1)',
            color: 'white',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.75rem'
          }}
        >
          {wireframe ? '◼ Solid' : '◻ Wireframe'}
        </button>
        <button
          onClick={() => setAutoRotate(!autoRotate)}
          style={{
            padding: '6px 12px',
            background: autoRotate ? '#3b82f6' : 'rgba(255,255,255,0.1)',
            color: 'white',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.75rem'
          }}
        >
          {autoRotate ? '⏸ Stop' : '▶ Rotate'}
        </button>
      </div>
      
      {/* Instructions */}
      <div style={{
        position: 'absolute',
        bottom: '12px',
        right: '12px',
        color: 'rgba(255,255,255,0.5)',
        fontSize: '0.7rem'
      }}>
        Drag to rotate • Scroll to zoom
      </div>
    </div>
  )
}
