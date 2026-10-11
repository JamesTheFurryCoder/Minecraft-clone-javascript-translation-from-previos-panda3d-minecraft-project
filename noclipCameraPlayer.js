import { FreeCamera, Vector3 } from "@babylonjs/core";

export class NoclipCameraPlayer {
  constructor(scene, canvas, {
    position = new Vector3(16, 16, 52),
    moveSpeed = 18,
    sprintMultiplier = 3,
    mouseSensitivity = 0.002,
  } = {}) {
    this.scene = scene;
    this.canvas = canvas;
    this.moveSpeed = moveSpeed;
    this.sprintMultiplier = sprintMultiplier;
    this.mouseSensitivity = mouseSensitivity;
    this.yaw = 0;
    this.pitch = -0.25;
    this.keysDown = new Set();
    this.lastFrameTime = performance.now();

    this.camera = new FreeCamera("noclip-camera", position, scene);
    this.camera.upVector = new Vector3(0, 0, 1);
    this.camera.checkCollisions = false;
    this.camera.applyGravity = false;
    this.camera.minZ = 0.1;
    this.updateCameraDirection();

    this.handleKeyDown = (event) => {
      this.keysDown.add(event.code);
      if (["Space", "ControlLeft", "ControlRight"].includes(event.code)) {
        event.preventDefault();
      }
    };
    this.handleKeyUp = (event) => this.keysDown.delete(event.code);
    this.handleBlur = () => this.keysDown.clear();
    this.handlePointerDown = (event) => {
      if (event.button === 0 && document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock();
      }
    };
    this.handleMouseMove = (event) => {
      if (document.pointerLockElement !== this.canvas) {
        return;
      }
      this.yaw += event.movementX * this.mouseSensitivity;
      this.pitch = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, this.pitch - event.movementY * this.mouseSensitivity)
      );
      this.updateCameraDirection();
    };

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    document.addEventListener("mousemove", this.handleMouseMove);
    this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => this.update());
  }

  updateCameraDirection() {
    const horizontalLength = Math.cos(this.pitch);
    this.forward = new Vector3(
      Math.cos(this.yaw) * horizontalLength,
      Math.sin(this.yaw) * horizontalLength,
      Math.sin(this.pitch)
    );
    this.camera.setTarget(this.camera.position.add(this.forward));
  }

  update() {
    const now = performance.now();
    const deltaTime = Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;

    const movement = Vector3.Zero();
    const forward = new Vector3(Math.cos(this.yaw), Math.sin(this.yaw), 0);
    const right = new Vector3(-Math.sin(this.yaw), Math.cos(this.yaw), 0);

    if (this.keysDown.has("KeyW")) movement.addInPlace(forward);
    if (this.keysDown.has("KeyS")) movement.subtractInPlace(forward);
    if (this.keysDown.has("KeyD")) movement.addInPlace(right);
    if (this.keysDown.has("KeyA")) movement.subtractInPlace(right);
    if (this.keysDown.has("Space")) movement.z += 1;
    if (this.keysDown.has("ControlLeft") || this.keysDown.has("ControlRight")) movement.z -= 1;

    if (movement.lengthSquared() === 0) {
      return;
    }

    movement.normalize();
    const sprinting = this.keysDown.has("ShiftLeft") || this.keysDown.has("ShiftRight");
    const speed = this.moveSpeed * (sprinting ? this.sprintMultiplier : 1);
    this.camera.position.addInPlace(movement.scale(speed * deltaTime));
    this.updateCameraDirection();
  }

  dispose() {
    this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    document.removeEventListener("mousemove", this.handleMouseMove);
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    this.camera.dispose();
  }
}