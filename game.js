import * as THREE from 'three';
import * as CANNON from 'cannon-es';

class XmasGame {
    constructor() {
        // Initialize collections first
        this.snowballs = [];
        this.toRemove = new Set(); // Track bodies to be removed safely
        
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x87CEEB);
        document.body.appendChild(this.renderer.domElement);

        // Initialize physics world
        this.initPhysics();
        
        // Game state
        this.isAiming = false;
        this.aimingStart = new THREE.Vector2();
        this.currentAim = new THREE.Vector2();
        
        this.debugElement = document.getElementById('debug');
        this.debugElement.innerHTML = 'Game initialized<br>';
        
        // Add cannon properties
        this.maxThrowPower = 60;
        this.currentPower = 30; // Default power
        
        // Setup scene and objects in correct order
        this.setupScene();
        this.setupSnowfall();  // Add snow system
        this.setupCannon();
        this.setupCard();
        this.setupControls();
        
        window.addEventListener('resize', this.handleResize.bind(this));
        
        // Start animation loop
        this.animate();
    }

    initPhysics() {
        // Create physics world with basic settings
        this.world = new CANNON.World();
        this.world.gravity.set(0, -9.82/4, 0); // Slowed down gravity by 4x
        this.world.broadphase = new CANNON.NaiveBroadphase();
        
        // More iterations for better stability
        this.world.solver.iterations = 20;
        this.world.solver.tolerance = 0.001;

        // Set up contact material properties
        const defaultMaterial = new CANNON.Material();
        const defaultContactMaterial = new CANNON.ContactMaterial(
            defaultMaterial,
            defaultMaterial,
            {
                friction: 0.3,
                restitution: 0.3,  // Reduced from 0.3 for less bounce
                contactEquationStiffness: 1e6,
                contactEquationRelaxation: 4
            }
        );
        this.world.addContactMaterial(defaultContactMaterial);
        this.world.defaultContactMaterial = defaultContactMaterial;

        // Create ground physics plane
        const groundShape = new CANNON.Plane();
        const groundBody = new CANNON.Body({
            type: CANNON.Body.STATIC,
            shape: groundShape,
            material: defaultMaterial,
            position: new CANNON.Vec3(0, -2, 60)  // Match visual ground position
        });
        groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        this.world.addBody(groundBody);
    }

    setupScene() {
        // Setup lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(5, 5, 5);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);

        // Enable shadows in renderer
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Position camera lower and further back for better sky view
        this.camera.position.set(0, 1, 12);
        // Adjust camera look target up by 10 degrees
        const lookAtHeight = 2 - Math.tan(Math.PI / 18) * 12;  // Calculate new lookAt height for 10-degree tilt
        this.camera.lookAt(0, lookAtHeight, 0);

        // Add voxel trees before loading background
        this.addVoxelTrees();

        // Load and setup aurora background first
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(
            'aurora.jpeg',
            (texture) => {
                // Create a background plane
                const aspect = texture.image.width / texture.image.height;
                const bgHeight = 50;
                const bgWidth = bgHeight * aspect;
                
                const bgGeometry = new THREE.PlaneGeometry(bgWidth, bgHeight);
                const bgMaterial = new THREE.MeshBasicMaterial({
                    map: texture,
                    side: THREE.DoubleSide,
                    transparent: true,
                    depthWrite: false,
                    color: 0x666666  // Darken the texture slightly
                });
                
                const background = new THREE.Mesh(bgGeometry, bgMaterial);
                // Move background lower and further back
                background.position.set(0, bgHeight/16, -40);  // Changed from bgHeight/6 to bgHeight/8 and z from -20 to -40
                this.scene.add(background);

                // Remove the sky blue background color and set to pure black
                this.renderer.setClearColor(0x000000, 1);

                // Create environment map
                const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
                pmremGenerator.compileEquirectangularShader();

                // Create environment map from the aurora texture
                const envMap = pmremGenerator.fromEquirectangular(texture).texture;
                this.scene.environment = envMap;  // Set scene environment

                // Now create the ground with reflection
                const groundGeometry = new THREE.PlaneGeometry(20, 160);  // Double length from 80 to 160
                
                // Load snow texture
                const snowTexture = new THREE.TextureLoader().load('snow.jpg');
                snowTexture.wrapS = THREE.RepeatWrapping;
                snowTexture.wrapT = THREE.RepeatWrapping;
                snowTexture.repeat.set(4, 32);  // Repeat texture to avoid stretching
                
                const groundMaterial = new THREE.MeshPhysicalMaterial({
                    color: 0xffffff,  // Pure white to preserve texture color
                    metalness: 0.2,    // Reduced metalness for more natural snow look
                    roughness: 0.8,    // Increased roughness for snow-like surface
                    envMap: envMap,    // Keep environment map for subtle reflections
                    envMapIntensity: 0.3,  // Reduced reflection intensity
                    map: snowTexture,  // Add snow texture
                    clearcoat: 0.2,    // Slight clearcoat for subtle shine
                    clearcoatRoughness: 0.7,  // High roughness for clearcoat
                    side: THREE.DoubleSide
                });

                this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
                this.ground.rotation.x = Math.PI / 2;
                this.ground.position.y = -2;
                this.ground.position.z = 60;
                this.ground.receiveShadow = true;
                this.scene.add(this.ground);

                // Clean up
                pmremGenerator.dispose();
            },
            undefined,
            (error) => {
                console.error('Error loading aurora background:', error);
            }
        );
    }

    setupCannon() {
        // Create cannon body (cylinder)
        const cannonGeometry = new THREE.CylinderGeometry(0.2, 0.3, 1, 16);
        const cannonMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
        this.cannonMesh = new THREE.Mesh(cannonGeometry, cannonMaterial);
        
        // Position cannon at ground level, opposite to the card
        this.cannonMesh.position.set(0, -1.5, 4);
        
        // Initial orientation: pointing towards the card (negative Z)
        this.cannonMesh.rotation.x = 0;
        this.cannonMesh.rotation.y = 0;
        this.scene.add(this.cannonMesh);

        // Create aim line
        const aimGeometry = new THREE.BufferGeometry();
        const aimMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
        this.aimLine = new THREE.Line(aimGeometry, aimMaterial);
        this.scene.add(this.aimLine);

        // Create aiming guide overlay
        const guideGeometry = new THREE.PlaneGeometry(2, 2);
        const guideMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.1,
            side: THREE.DoubleSide
        });
        this.aimGuide = new THREE.Mesh(guideGeometry, guideMaterial);
        this.aimGuide.position.set(2, 0, 4); // Position to the right of the cannon
        this.scene.add(this.aimGuide);

        // Create aim point indicator
        const aimPointGeometry = new THREE.CircleGeometry(0.05, 32);
        const aimPointMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.5
        });
        this.aimPoint = new THREE.Mesh(aimPointGeometry, aimPointMaterial);
        this.aimPoint.position.z = 0.01; // Slightly in front of guide
        this.aimGuide.add(this.aimPoint);

        // Add grid lines to show angle divisions
        const gridMaterial = new THREE.LineBasicMaterial({ 
            color: 0xffffff, 
            transparent: true, 
            opacity: 0.2 
        });

        // Horizontal lines (elevation angles)
        for (let i = 0; i <= 4; i++) {
            const y = -1 + (i * 0.5); // -1 to 1 in 4 steps
            const lineGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(-1, y, 0),
                new THREE.Vector3(1, y, 0)
            ]);
            const line = new THREE.Line(lineGeometry, gridMaterial);
            this.aimGuide.add(line);
        }

        // Vertical lines (azimuth angles)
        for (let i = 0; i <= 4; i++) {
            const x = -1 + (i * 0.5); // -1 to 1 in 4 steps
            const lineGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(x, -1, 0),
                new THREE.Vector3(x, 1, 0)
            ]);
            const line = new THREE.Line(lineGeometry, gridMaterial);
            this.aimGuide.add(line);
        }

        // Add angle labels
        const angles = [
            { pos: new THREE.Vector3(-1.1, 0, 0), text: "-90°" },
            { pos: new THREE.Vector3(1.1, 0, 0), text: "90°" },
            { pos: new THREE.Vector3(0, 1.1, 0), text: "90°" },
            { pos: new THREE.Vector3(0, -1.1, 0), text: "0°" }
        ];

        angles.forEach(({ pos, text }) => {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 32;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, canvas.width/2, canvas.height/2);

            const texture = new THREE.CanvasTexture(canvas);
            const labelMaterial = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                opacity: 0.5
            });
            const label = new THREE.Sprite(labelMaterial);
            label.position.copy(pos);
            label.scale.set(0.5, 0.25, 1);
            this.aimGuide.add(label);
        });
    }

    setupCard() {
        // Load card texture first to get dimensions
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(
            'kortti.jpeg',
            (texture) => {
                console.log('Texture loaded successfully');
                this.debugElement.innerHTML += 'Texture loaded<br>';
                
                // Get image dimensions
                const imageWidth = texture.image.width;
                const imageHeight = texture.image.height;
                const aspectRatio = imageHeight / imageWidth;
                
                // Create card with correct aspect ratio
                // Increased base width from 3 to 4 units
                const cardWidth = 4;  // Changed from 3 to 4
                const cardHeight = cardWidth * aspectRatio;
                
                console.log('Card dimensions:', {
                    imageWidth, imageHeight,
                    aspectRatio,
                    cardWidth, cardHeight
                });

                const cardGeometry = new THREE.PlaneGeometry(cardWidth, cardHeight);
                const cardMaterial = new THREE.MeshStandardMaterial({ 
                    map: texture,
                    color: 0xffffff,
                    side: THREE.DoubleSide
                });
                
                this.card = new THREE.Mesh(cardGeometry, cardMaterial);
                // Move the card slightly back to maintain good perspective
                this.card.position.z = -1;
                this.scene.add(this.card);

                // Create snow overlays with matching dimensions
                const overlayGeometry = new THREE.PlaneGeometry(cardWidth, cardHeight);
                
                // Initialize front snow canvas with same dimensions as image
                this.snowCanvasFront = document.createElement('canvas');
                this.snowCanvasFront.width = imageWidth;
                this.snowCanvasFront.height = imageHeight;
                this.snowContextFront = this.snowCanvasFront.getContext('2d');
                this.snowContextFront.fillStyle = 'rgba(0, 0, 0, 0)';
                this.snowContextFront.fillRect(0, 0, this.snowCanvasFront.width, this.snowCanvasFront.height);

                // Initialize back snow canvas
                this.snowCanvasBack = document.createElement('canvas');
                this.snowCanvasBack.width = imageWidth;
                this.snowCanvasBack.height = imageHeight;
                this.snowContextBack = this.snowCanvasBack.getContext('2d');
                this.snowContextBack.fillStyle = 'rgba(0, 0, 0, 0)';
                this.snowContextBack.fillRect(0, 0, this.snowCanvasBack.width, this.snowCanvasBack.height);

                // Rest of overlay setup...
                const snowTextureFront = new THREE.CanvasTexture(this.snowCanvasFront);
                const overlayMaterialFront = new THREE.MeshBasicMaterial({
                    map: snowTextureFront,
                    transparent: true,
                    opacity: 0.8,
                    side: THREE.FrontSide,
                    depthWrite: false
                });

                const snowTextureBack = new THREE.CanvasTexture(this.snowCanvasBack);
                const overlayMaterialBack = new THREE.MeshBasicMaterial({
                    map: snowTextureBack,
                    transparent: true,
                    opacity: 0.8,
                    side: THREE.BackSide,
                    depthWrite: false
                });

                this.snowOverlayFront = new THREE.Mesh(overlayGeometry, overlayMaterialFront);
                this.snowOverlayBack = new THREE.Mesh(overlayGeometry, overlayMaterialBack);
                
                // Position overlays exactly at card's local origin
                this.snowOverlayFront.position.set(0, 0, 0.001);
                this.snowOverlayBack.position.set(0, 0, -0.001);
                
                this.card.add(this.snowOverlayFront);
                this.card.add(this.snowOverlayBack);

                // Update physics body to match new dimensions
                const cardShape = new CANNON.Box(new CANNON.Vec3(cardWidth/2, cardHeight/2, 0.1));
                this.cardBody = new CANNON.Body({
                    mass: 1,
                    type: CANNON.Body.DYNAMIC
                });
                this.cardBody.addShape(cardShape);
                this.cardBody.position.set(0, 0, -1); // Match visual position
                
                this.cardBody.linearDamping = 0.3;
                this.cardBody.angularDamping = 0.3;
                
                this.world.addBody(this.cardBody);

                // Adjust anchor point for larger card
                this.anchorBody = new CANNON.Body({
                    mass: 0,
                    type: CANNON.Body.STATIC,
                    position: new CANNON.Vec3(0, cardHeight/2 + 0.5, -1)  // Match card Z position
                });
                this.world.addBody(this.anchorBody);

                // Create point-to-point constraint
                const pivotA = new CANNON.Vec3(0, cardHeight/2, 0);
                const pivotB = new CANNON.Vec3(0, 0, 0);
                
                this.constraint = new CANNON.PointToPointConstraint(
                    this.cardBody,
                    pivotA,
                    this.anchorBody,
                    pivotB,
                    100
                );
                
                this.world.addConstraint(this.constraint);
            },
            undefined,
            (error) => {
                console.error('Error loading texture:', error);
                this.debugElement.innerHTML += 'Texture load error: ' + error + '<br>';
            }
        );
    }

    setupSnowfall() {
        // Create snow particles
        const snowGeometry = new THREE.BufferGeometry();
        const snowCount = 10000;  // Increased from 5000 for more volume
        const positions = new Float32Array(snowCount * 3);
        const velocities = new Float32Array(snowCount * 3);
        const randomFactors = new Float32Array(snowCount);  // For individual particle variation
        
        // Set initial positions and velocities
        for(let i = 0; i < snowCount * 3; i += 3) {
            // Random positions in a larger volume above and around the scene
            positions[i] = Math.random() * 60 - 30;     // x: -30 to 30
            positions[i + 1] = Math.random() * 60 + 10; // y: 10 to 70 (increased height range)
            positions[i + 2] = Math.random() * 180 - 20; // z: -20 to 160

            // Slower, more varied falling velocities
            velocities[i] = (Math.random() - 0.5) * 0.03;      // x: very slight drift
            velocities[i + 1] = -(Math.random() * 0.03 + 0.02); // y: slower downward
            velocities[i + 2] = (Math.random() - 0.5) * 0.03;  // z: very slight drift

            // Random factor for individual particle behavior
            randomFactors[i/3] = Math.random();
        }

        snowGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        // Create snow material with a softer, more natural looking particle
        const canvas = document.createElement('canvas');
        canvas.width = 32;  // Increased from 16 for better quality
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        
        // Draw a softer white circle with more natural falloff
        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');  // Increased opacity
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)'); // Increased middle opacity
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 32, 32);
        
        const snowTexture = new THREE.CanvasTexture(canvas);
        
        const snowMaterial = new THREE.PointsMaterial({
            size: 0.3,  // Increased from 0.15 for larger particles
            map: snowTexture,
            transparent: true,
            opacity: 0.8,  // Increased from 0.6
            vertexColors: false,
            depthWrite: false,
            depthTest: false,  // Ensures particles render on top of everything
            blending: THREE.AdditiveBlending  // Add blending for more volumetric look
        });

        this.snowParticles = new THREE.Points(snowGeometry, snowMaterial);
        this.snowParticles.renderOrder = 999;  // Ensure snow renders last
        this.scene.add(this.snowParticles);
        
        // Store properties for animation
        this.snowVelocities = velocities;
        this.snowRandomFactors = randomFactors;
        this.snowCount = snowCount;
        this.activeSnowCount = snowCount;
        this.time = 0;  // Add time tracking for wind effect
    }

    setupControls() {
        this.renderer.domElement.addEventListener('mousedown', this.startAiming.bind(this));
        this.renderer.domElement.addEventListener('mousemove', this.updateAiming.bind(this));
        this.renderer.domElement.addEventListener('mouseup', this.throwSnowball.bind(this));
        
        this.sizeSlider = document.getElementById('snowball-size');
        this.powerSlider = document.getElementById('cannon-power');
        this.snowDensitySlider = document.getElementById('snow-density');
        
        // Update power when slider changes
        this.powerSlider.addEventListener('input', (e) => {
            this.currentPower = (parseFloat(e.target.value) / 100) * this.maxThrowPower;
        });

        // Update snow density when slider changes
        if (this.snowDensitySlider) {
            this.snowDensitySlider.addEventListener('input', (e) => {
                const density = parseFloat(e.target.value) / 100;
                this.activeSnowCount = Math.floor(this.snowCount * density);
                this.snowParticles.geometry.setDrawRange(0, this.activeSnowCount);
            });
        }
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        
        this.time += 0.001;  // Update time for snow animation

        // Update snow particles
        if (this.snowParticles && this.snowVelocities) {
            const positions = this.snowParticles.geometry.attributes.position.array;
            
            for(let i = 0; i < this.activeSnowCount * 3; i += 3) {
                const randomFactor = this.snowRandomFactors[i/3];
                
                // Add gentle sine wave motion for more natural swaying
                const windEffect = Math.sin(this.time + positions[i] * 0.1) * 0.01 * randomFactor;
                
                // Update positions with wind effect and original velocities
                positions[i] += this.snowVelocities[i] + windEffect;
                positions[i + 1] += this.snowVelocities[i + 1];
                positions[i + 2] += this.snowVelocities[i + 2] + windEffect;

                // Reset particles that fall below ground with better distribution
                if (positions[i + 1] < -2) {
                    // Redistribute across the entire ground plane and at higher elevation
                    positions[i] = Math.random() * 60 - 30;     // x: -30 to 30
                    positions[i + 1] = Math.random() * 10 + 60;  // y: 60 to 70 (higher respawn)
                    positions[i + 2] = Math.random() * 180 - 20; // z: -20 to 160
                }

                // Wrap particles that drift too far horizontally
                if (Math.abs(positions[i]) > 30) {
                    positions[i] = -Math.sign(positions[i]) * 30;
                }
                if (positions[i + 2] < -20 || positions[i + 2] > 160) {
                    positions[i + 2] = positions[i + 2] < -20 ? 160 : -20;
                }
            }
            
            this.snowParticles.geometry.attributes.position.needsUpdate = true;
        }

        if (this.world) {
            try {
                const fixedTimeStep = 1.0 / 60.0;
                const maxSubSteps = 3;
                
                this.world.step(fixedTimeStep, fixedTimeStep, maxSubSteps);
                this.cleanupPhysics();

                // Update card position and rotation from physics
                if (this.cardBody && this.card) {
                    this.card.position.copy(this.cardBody.position);
                    this.card.quaternion.copy(this.cardBody.quaternion);
                }

                // Update snowballs
                for (let i = this.snowballs.length - 1; i >= 0; i--) {
                    const snowball = this.snowballs[i];
                    if (snowball && snowball.body && snowball.mesh && 
                        this.world.bodies.includes(snowball.body) &&
                        !this.toRemove.has(snowball)) {
                        
                        snowball.timeAlive += fixedTimeStep;
                        snowball.mesh.position.copy(snowball.body.position);
                        snowball.mesh.quaternion.copy(snowball.body.quaternion);

                        if (snowball.timeAlive > 5 || snowball.body.position.y < -3) {
                            this.removeSnowball(snowball);
                        }
                    }
                }
            } catch (error) {
                console.error('Physics update error:', error);
                this.cleanupPhysics();
            }
        }

        this.renderer.render(this.scene, this.camera);
    }

    startAiming(event) {
        this.isAiming = true;
        this.aimingStart.set(event.clientX, event.clientY);
        this.currentAim.copy(this.aimingStart);
        this.throwPower = 0;
        this.updateAimVisuals(event);
    }

    updateAiming(event) {
        if (!this.isAiming) return;
        this.currentAim.set(event.clientX, event.clientY);
        this.updateAimVisuals(event);
    }

    updateAimVisuals(event) {
        if (!this.isAiming) return;

        // Calculate mouse position in normalized coordinates (-1 to 1)
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Update aim point position on guide
        if (this.aimPoint) {
            this.aimPoint.position.x = x;
            this.aimPoint.position.y = y;
        }

        // Rest of the existing updateAimVisuals code...
        const azimuthAngle = (-x * Math.PI / 2);
        const elevationAngle = (y + 1) * Math.PI / 4;

        // Update cannon orientation
        this.cannonMesh.rotation.set(0, 0, 0);
        this.cannonMesh.rotateY(azimuthAngle);
        this.cannonMesh.rotateX(-elevationAngle);

        // Calculate direction vector for aim line
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyEuler(this.cannonMesh.rotation);

        // Update aim line
        const aimLength = 4 + this.currentPower * 0.05;
        const points = [
            this.cannonMesh.position.clone(),
            this.cannonMesh.position.clone().add(direction.multiplyScalar(aimLength))
        ];
        this.aimLine.geometry.setFromPoints(points);
    }

    throwSnowball(event) {
        if (!this.isAiming) return;
        this.isAiming = false;

        // Hide aim line
        this.aimLine.geometry.setFromPoints([]);

        // Calculate snowball size
        const snowballSize = parseFloat(this.sizeSlider.value) * 0.1;

        // Create snowball at cannon's muzzle
        const geometry = new THREE.SphereGeometry(snowballSize);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0xffffff,
            metalness: 0.1,
            roughness: 0.8
        });
        const snowballMesh = new THREE.Mesh(geometry, material);
        
        // Position snowball at the cannon's muzzle end
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyEuler(this.cannonMesh.rotation);
        const muzzleOffset = direction.multiplyScalar(0.5);
        
        snowballMesh.position.copy(this.cannonMesh.position).add(muzzleOffset);
        this.scene.add(snowballMesh);

        // Create physics snowball with adjusted properties
        const snowballBody = new CANNON.Body({
            mass: 0.1,
            type: CANNON.Body.DYNAMIC,
            shape: new CANNON.Sphere(snowballSize),
            linearDamping: 0.1,  // Added damping to reduce bouncing
            angularDamping: 0.1
        });
        snowballBody.position.copy(snowballMesh.position);
        
        // Get direction for velocity
        direction.set(0, 0, -1);
        direction.applyEuler(this.cannonMesh.rotation);
        
        // Apply velocity using the current power setting
        const speed = this.currentPower * 0.5;
        snowballBody.velocity.set(
            direction.x * speed,
            direction.y * speed,
            direction.z * speed
        );
        
        this.world.addBody(snowballBody);

        const snowball = {
            mesh: snowballMesh,
            body: snowballBody,
            timeAlive: 0,
            isCollided: false
        };
        this.snowballs.push(snowball);

        // Handle collision
        snowballBody.addEventListener('collide', (e) => {
            if (!snowball.isCollided && e.body === this.cardBody) {
                snowball.isCollided = true;
                
                // Get collision point in world coordinates
                const contact = e.contact;
                const cardIsBody1 = contact.bi.id === this.cardBody.id;
                
                // Get the contact point relative to the card's position
                const contactPoint = new THREE.Vector3();
                if (cardIsBody1) {
                    contactPoint.set(
                        this.cardBody.position.x + contact.ri.x,
                        this.cardBody.position.y + contact.ri.y,
                        this.cardBody.position.z + contact.ri.z
                    );
                } else {
                    contactPoint.set(
                        this.cardBody.position.x + contact.rj.x,
                        this.cardBody.position.y + contact.rj.y,
                        this.cardBody.position.z + contact.rj.z
                    );
                }

                // Get normal pointing from card to snowball
                const contactNormal = new CANNON.Vec3();
                if (cardIsBody1) {
                    contact.ni.negate(contactNormal);
                } else {
                    contactNormal.copy(contact.ni);
                }

                // Convert world contact point to local card coordinates
                const localPos = new THREE.Vector3();
                localPos.copy(contactPoint);
                this.card.worldToLocal(localPos);

                // Debug output
                console.log('Contact point:', contactPoint);
                console.log('Local position:', localPos);
                console.log('Normal:', contactNormal);

                this.addSnowSplat(localPos, contactNormal);
                this.removeSnowball(snowball);
            }
        });
    }

    addSnowSplat(localPosition, normal) {
        // Convert normal to local space of the card
        const localNormal = new THREE.Vector3();
        localNormal.copy(normal);
        this.card.worldToLocal(localNormal.add(this.card.position));
        localNormal.normalize();

        // Determine which side was hit based on normal vector in local space
        // When local normal's Z is negative, we hit the front side
        // (because normals point outward from the surface)
        const hitFront = localNormal.z < 0;
        const canvas = hitFront ? this.snowCanvasFront : this.snowCanvasBack;
        const context = hitFront ? this.snowContextFront : this.snowContextBack;
        const overlay = hitFront ? this.snowOverlayFront : this.snowOverlayBack;

        // Debug output for side detection
        console.log('Hit detection:', {
            worldNormal: normal,
            localNormal: localNormal,
            hitFront: hitFront,
            side: hitFront ? "front" : "back"
        });

        // Convert local position to UV coordinates
        // The card geometry extends from -1.5 to 1.5 in X and -2.25 to 2.25 in Y
        const u = (localPosition.x / 1.5 + 1) * 0.5;
        const v = (localPosition.y / 2.25 + 1) * 0.5;

        // Clamp UV coordinates to prevent drawing outside the texture
        const clampedU = Math.max(0, Math.min(1, u));
        const clampedV = Math.max(0, Math.min(1, v));
        
        // Convert UV to canvas pixels
        const x = clampedU * canvas.width;
        const y = (1 - clampedV) * canvas.height;  // Flip Y for canvas coordinates

        // Draw snow splat with random size and opacity
        const size = 20 + Math.random() * 20;
        const opacity = 0.3 + Math.random() * 0.3;
        
        context.fillStyle = `rgba(255, 255, 255, ${opacity})`;
        context.beginPath();
        context.arc(x, y, size, 0, Math.PI * 2);
        context.fill();

        // Add some smaller random circles around the main splat
        for (let i = 0; i < 5; i++) {
            const smallSize = size * (0.2 + Math.random() * 0.3);
            const angle = Math.random() * Math.PI * 2;
            const distance = size * (0.5 + Math.random() * 0.5);
            const smallX = Math.max(0, Math.min(canvas.width, x + Math.cos(angle) * distance));
            const smallY = Math.max(0, Math.min(canvas.height, y + Math.sin(angle) * distance));
            
            context.beginPath();
            context.arc(smallX, smallY, smallSize, 0, Math.PI * 2);
            context.fill();
        }

        // Update texture
        overlay.material.map.needsUpdate = true;
    }

    handleResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // Add new method to safely remove snowballs
    removeSnowball(snowball) {
        // Mark for removal instead of removing immediately
        this.toRemove.add(snowball);
    }

    // New method to safely clean up physics bodies
    cleanupPhysics() {
        // Process removals after physics step
        for (const snowball of this.toRemove) {
            if (snowball.mesh) {
                this.scene.remove(snowball.mesh);
            }
            if (snowball.body) {
                // Make sure body is still in the world
                if (this.world.bodies.includes(snowball.body)) {
                    this.world.removeBody(snowball.body);
                }
            }
            const index = this.snowballs.indexOf(snowball);
            if (index > -1) {
                this.snowballs.splice(index, 1);
            }
        }
        this.toRemove.clear();
    }

    createVoxelTree(x, z, height) {
        const trunkHeight = height * 0.3;  // Reduced to 30% of total height for fir proportions
        const treeGroup = new THREE.Group();
        
        // Create trunk material with darker wood texture
        const trunkMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x3d2817  // Darker brown for fir trunk
        });

        // Create leaves material with darker, more saturated green
        const leavesMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x0f5032  // Darker green for fir needles
        });

        // Create trunk
        const trunkGeometry = new THREE.BoxGeometry(0.8, trunkHeight, 0.8);  // Slightly thinner trunk
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.set(0, trunkHeight/2, 0);  // Position trunk half its height up
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        treeGroup.add(trunk);

        // Create leaves (conical structure with more layers)
        const leavesLayers = 6;  // More layers for a denser look
        const maxLeafWidth = 4;  // Wider base for more conical shape

        for (let layer = 0; layer < leavesLayers; layer++) {
            // Calculate layer properties for a more conical shape
            const layerProgress = layer / leavesLayers;
            const layerSize = maxLeafWidth * (1 - layerProgress * 0.8);  // Gradual size reduction
            const yPos = trunkHeight + (layer * 0.8);  // Slightly overlap layers
            
            // Create each block in the layer
            for (let dx = -layerSize; dx <= layerSize; dx++) {
                for (let dz = -layerSize; dz <= layerSize; dz++) {
                    // Skip blocks that are too far from center to create circular layers
                    const distFromCenter = Math.sqrt(dx * dx + dz * dz);
                    if (distFromCenter > layerSize) continue;
                    
                    // Skip some inner blocks randomly for variation
                    if (distFromCenter < layerSize - 0.5 && Math.random() < 0.3) continue;
                    
                    const leafGeometry = new THREE.BoxGeometry(0.9, 0.9, 0.9);
                    const leaf = new THREE.Mesh(leafGeometry, leavesMaterial);
                    
                    // Add slight random offset for less uniform look
                    const offsetX = (Math.random() - 0.5) * 0.2;
                    const offsetZ = (Math.random() - 0.5) * 0.2;
                    
                    leaf.position.set(
                        dx * 0.5 + offsetX,  // Tighter spacing
                        yPos,
                        dz * 0.5 + offsetZ   // Tighter spacing
                    );
                    
                    // Rotate each leaf slightly for more natural look
                    leaf.rotation.y = Math.random() * Math.PI * 0.25;
                    
                    leaf.castShadow = true;
                    leaf.receiveShadow = true;
                    treeGroup.add(leaf);
                }
            }
        }

        // Position the entire tree at ground level (y=-2)
        treeGroup.position.set(x, -2, z);  // Changed from 0 to -2 to match ground plane
        return treeGroup;
    }

    addVoxelTrees() {
        // Add trees in a semi-random pattern behind the card
        const treePositions = [
            { x: -8, z: -10, height: 10 },
            { x: 8, z: -12, height: 9 },
            { x: -5, z: -15, height: 11 },
            { x: 3, z: -8, height: 8 },
            { x: 12, z: -14, height: 10 },
            { x: -12, z: -13, height: 9 },
            { x: 6, z: -16, height: 11 },
            { x: -3, z: -12, height: 9 }
        ];

        treePositions.forEach(pos => {
            const tree = this.createVoxelTree(pos.x, pos.z, pos.height);
            this.scene.add(tree);
        });
    }
}

// Start the game
window.addEventListener('load', () => {
    const game = new XmasGame();
});

export { XmasGame }; 