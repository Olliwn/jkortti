import * as THREE from 'three';
import * as CANNON from 'cannon-es';

class XmasGame {
    constructor() {
        // Initialize collections first
        this.snowballs = [];
        this.toRemove = new Set(); // Track bodies to be removed safely
        
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
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
        
        this.setupScene();
        this.setupCard();
        this.setupControls();
        
        window.addEventListener('resize', this.handleResize.bind(this));
        
        // Start animation loop
        this.animate();

        // Add cannon properties
        this.maxThrowPower = 60;
        this.currentPower = 30; // Default power
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
                restitution: 0.3,
                contactEquationStiffness: 1e6,
                contactEquationRelaxation: 4
            }
        );
        this.world.addContactMaterial(defaultContactMaterial);
        this.world.defaultContactMaterial = defaultContactMaterial;

        // Create ground
        const groundShape = new CANNON.Plane();
        const groundBody = new CANNON.Body({
            type: CANNON.Body.STATIC,
            shape: groundShape,
            material: defaultMaterial
        });
        groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        groundBody.position.set(0, -2, 0);
        this.world.addBody(groundBody);
    }

    setupScene() {
        // Setup lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(5, 5, 5);
        this.scene.add(directionalLight);

        // Position camera higher and further back for better view
        this.camera.position.set(0, 3, 8);
        this.camera.lookAt(0, 0, 0);

        // Add a ground plane for reference
        const groundGeometry = new THREE.PlaneGeometry(10, 10);
        const groundMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xFFFFFF,
            side: THREE.DoubleSide
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = Math.PI / 2;
        ground.position.y = -2;
        this.scene.add(ground);

        // Add cannon
        this.setupCannon();
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

        // Create power bar background - move it next to the cannon
        const powerBarBgGeometry = new THREE.PlaneGeometry(0.3, 2);
        const powerBarBgMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x333333,
            transparent: true,
            opacity: 0.5
        });
        this.powerBarBg = new THREE.Mesh(powerBarBgGeometry, powerBarBgMaterial);
        this.powerBarBg.position.set(1, -1.5, 4); // Next to cannon
        this.scene.add(this.powerBarBg);

        // Create power bar fill
        const powerBarGeometry = new THREE.PlaneGeometry(0.2, 1.9);
        const powerBarMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00ff00
        });
        this.powerBar = new THREE.Mesh(powerBarGeometry, powerBarMaterial);
        this.powerBar.position.set(1, -2.4, 4.1); // Slightly in front of background
        this.powerBar.scale.y = 0; // Start empty
        this.scene.add(this.powerBar);
    }

    setupCard() {
        // Create card with temporary red color first - 50% bigger
        const cardGeometry = new THREE.PlaneGeometry(3, 4.5);
        const cardMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xff0000,
            side: THREE.DoubleSide
        });
        
        this.card = new THREE.Mesh(cardGeometry, cardMaterial);
        this.scene.add(this.card);

        // Load card texture
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(
            'kortti.jpeg',
            (texture) => {
                console.log('Texture loaded successfully');
                this.debugElement.innerHTML += 'Texture loaded<br>';
                this.card.material.map = texture;
                this.card.material.color.setHex(0xffffff);
                this.card.material.needsUpdate = true;
            },
            undefined,
            (error) => {
                console.error('Error loading texture:', error);
                this.debugElement.innerHTML += 'Texture load error: ' + error + '<br>';
            }
        );

        // Initialize front snow canvas
        this.snowCanvasFront = document.createElement('canvas');
        this.snowCanvasFront.width = 512;
        this.snowCanvasFront.height = 768;
        this.snowContextFront = this.snowCanvasFront.getContext('2d');
        this.snowContextFront.fillStyle = 'rgba(0, 0, 0, 0)';
        this.snowContextFront.fillRect(0, 0, this.snowCanvasFront.width, this.snowCanvasFront.height);

        // Initialize back snow canvas
        this.snowCanvasBack = document.createElement('canvas');
        this.snowCanvasBack.width = 512;
        this.snowCanvasBack.height = 768;
        this.snowContextBack = this.snowCanvasBack.getContext('2d');
        this.snowContextBack.fillStyle = 'rgba(0, 0, 0, 0)';
        this.snowContextBack.fillRect(0, 0, this.snowCanvasBack.width, this.snowCanvasBack.height);

        // Create snow overlays with the same geometry as the card
        const overlayGeometry = new THREE.PlaneGeometry(3, 4.5);
        
        // Front overlay
        const snowTextureFront = new THREE.CanvasTexture(this.snowCanvasFront);
        const overlayMaterialFront = new THREE.MeshBasicMaterial({
            map: snowTextureFront,
            transparent: true,
            opacity: 0.8,
            side: THREE.FrontSide,
            depthWrite: false
        });

        // Back overlay
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
        this.snowOverlayFront.position.set(0, 0, 0.001);  // Slightly in front
        this.snowOverlayBack.position.set(0, 0, -0.001);  // Slightly behind
        
        // Add overlays as children of the card
        this.card.add(this.snowOverlayFront);
        this.card.add(this.snowOverlayBack);

        // Create card body
        const cardShape = new CANNON.Box(new CANNON.Vec3(1.5, 2.25, 0.1)); // Increased to match visual size
        this.cardBody = new CANNON.Body({
            mass: 1,
            type: CANNON.Body.DYNAMIC
        });
        this.cardBody.addShape(cardShape);
        this.cardBody.position.set(0, 0, 0);
        
        // Add some damping to make it more stable
        this.cardBody.linearDamping = 0.3;
        this.cardBody.angularDamping = 0.3;
        
        this.world.addBody(this.cardBody);

        // Create anchor point
        this.anchorBody = new CANNON.Body({
            mass: 0,
            type: CANNON.Body.STATIC,
            position: new CANNON.Vec3(0, 3, 0)
        });
        this.world.addBody(this.anchorBody);

        // Create point-to-point constraint (like a string)
        const pivotA = new CANNON.Vec3(0, 1.5, 0); // Local point in card body
        const pivotB = new CANNON.Vec3(0, 0, 0);   // Local point in anchor body
        
        this.constraint = new CANNON.PointToPointConstraint(
            this.cardBody,
            pivotA,
            this.anchorBody,
            pivotB,
            100 // maxForce
        );
        
        this.world.addConstraint(this.constraint);
    }

    setupControls() {
        this.renderer.domElement.addEventListener('mousedown', this.startAiming.bind(this));
        this.renderer.domElement.addEventListener('mousemove', this.updateAiming.bind(this));
        this.renderer.domElement.addEventListener('mouseup', this.throwSnowball.bind(this));
        
        this.sizeSlider = document.getElementById('snowball-size');
        this.powerSlider = document.getElementById('cannon-power');
        
        // Update power when slider changes
        this.powerSlider.addEventListener('input', (e) => {
            this.currentPower = (parseFloat(e.target.value) / 100) * this.maxThrowPower;
            if (this.powerBar) {
                this.updatePowerBar();
            }
        });
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));

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

        // Convert to polar coordinates
        // Horizontal angle: -90 to +90 degrees
        const azimuthAngle = (-x * Math.PI / 2);
        
        // Vertical angle: 0 to 90 degrees
        // Map y from [-1, 1] directly to [0, PI/2]
        // This ensures a more linear and intuitive vertical aiming
        const elevationAngle = Math.max(0, Math.min(Math.PI / 2, (y + 1) * Math.PI / 2));

        // Update cannon orientation
        this.cannonMesh.rotation.set(0, 0, 0);
        this.cannonMesh.rotateY(azimuthAngle);
        this.cannonMesh.rotateX(-elevationAngle);

        // Calculate direction vector for aim line
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyEuler(this.cannonMesh.rotation);

        // Update aim line - make it longer for better visibility at high power
        const aimLength = 4 + this.currentPower * 0.05;  // Adjusted for higher power range
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

        const snowballSize = parseFloat(this.sizeSlider.value) * 0.2;

        // Create snowball at cannon's muzzle
        const geometry = new THREE.SphereGeometry(snowballSize);
        const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const snowballMesh = new THREE.Mesh(geometry, material);
        
        // Position snowball at the cannon's muzzle end
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyEuler(this.cannonMesh.rotation);
        const muzzleOffset = direction.multiplyScalar(0.5);  // Half the cannon length
        
        snowballMesh.position.copy(this.cannonMesh.position).add(muzzleOffset);
        this.scene.add(snowballMesh);

        // Create physics snowball
        const snowballBody = new CANNON.Body({
            mass: 0.1,
            type: CANNON.Body.DYNAMIC,
            shape: new CANNON.Sphere(snowballSize)
        });
        snowballBody.position.copy(snowballMesh.position);
        
        // Get direction for velocity
        direction.set(0, 0, -1);
        direction.applyEuler(this.cannonMesh.rotation);
        
        // Apply velocity using the current power setting
        const speed = this.currentPower * 0.5;  // Kept the same ratio for physics stability
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

    updatePowerBar() {
        const powerScale = this.currentPower / this.maxThrowPower;
        this.powerBar.scale.y = powerScale;
        this.powerBar.position.y = -2.4 + (powerScale * 0.95);
    }
}

// Start the game
window.addEventListener('load', () => {
    const game = new XmasGame();
});

export { XmasGame }; 