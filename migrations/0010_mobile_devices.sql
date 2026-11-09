-- Preserve installed migration bytes; widen only the native device allowlist.
ALTER TABLE cloud_devices DROP CONSTRAINT cloud_devices_platform_check;
ALTER TABLE cloud_devices ADD CONSTRAINT cloud_devices_platform_check CHECK (platform IN ('macos', 'windows', 'linux', 'ios', 'android'));
