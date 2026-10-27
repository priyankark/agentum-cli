//! Synchronous Node-API input bridge; capture stays in Agentum's existing pipeline.
use napi::{Error, Result};
use napi_derive::napi;
use rusty_robot::Robot;

fn native<T>(result: rusty_robot::Result<T>) -> Result<T> {
    result.map_err(|error| Error::from_reason(error.to_string()))
}

// f64 preserves the original JS value until validation, unlike N-API's coercing
// integer conversions. The core library supports native signed 32-bit positions.
fn coordinate(value: f64) -> Result<i64> {
    if !value.is_finite()
        || value.fract() != 0.0
        || value < i32::MIN as f64
        || value > i32::MAX as f64
    {
        return Err(Error::from_reason(
            "Expected a finite signed 32-bit integer",
        ));
    }
    Ok(value as i64)
}

#[napi(object)]
pub struct ScreenSize {
    pub width: u32,
    pub height: u32,
}
#[napi(object)]
pub struct Pointer {
    pub x: f64,
    pub y: f64,
}
#[napi(object)]
pub struct Permissions {
    pub accessibility: Option<bool>,
    pub screen_capture: Option<bool>,
}

#[napi]
pub fn get_screen_size() -> Result<ScreenSize> {
    let size = native(Robot.get_screen_size())?;
    Ok(ScreenSize {
        width: u32::try_from(size.width)
            .map_err(|_| Error::from_reason("Display width overflow"))?,
        height: u32::try_from(size.height)
            .map_err(|_| Error::from_reason("Display height overflow"))?,
    })
}
#[napi]
pub fn get_mouse_pos() -> Result<Pointer> {
    let point = native(Robot.get_mouse_pos())?;
    Ok(Pointer {
        x: point.x as f64,
        y: point.y as f64,
    })
}
#[napi]
pub fn get_permissions() -> Result<Permissions> {
    Ok(Permissions {
        accessibility: native(Robot.get_accessibility_permission())?,
        screen_capture: native(Robot.get_screen_capture_permission())?,
    })
}
#[napi]
pub fn move_mouse(x: f64, y: f64) -> Result<()> {
    native(Robot.move_mouse(coordinate(x)?, coordinate(y)?))
}
#[napi]
pub fn drag_mouse(x: f64, y: f64, button: String) -> Result<()> {
    native(Robot.drag_mouse(coordinate(x)?, coordinate(y)?, Some(&button)))
}
#[napi]
pub fn mouse_toggle(state: String, button: String) -> Result<()> {
    native(Robot.mouse_toggle(&state, Some(&button)))
}
#[napi]
pub fn scroll_mouse(x: f64, y: f64) -> Result<()> {
    native(Robot.scroll_mouse(coordinate(x)?, coordinate(y)?))
}
#[napi]
pub fn key_tap(key: String, modifiers: Option<Vec<String>>) -> Result<()> {
    let modifiers = modifiers.unwrap_or_default();
    native(Robot.key_tap(
        &key,
        &modifiers.iter().map(String::as_str).collect::<Vec<_>>(),
    ))
}
#[napi]
pub fn key_toggle(key: String, state: String, modifiers: Option<Vec<String>>) -> Result<()> {
    let modifiers = modifiers.unwrap_or_default();
    native(Robot.key_toggle(
        &key,
        &state,
        &modifiers.iter().map(String::as_str).collect::<Vec<_>>(),
    ))
}
#[napi]
pub fn type_string(text: String) -> Result<()> {
    native(Robot.type_string(&text))
}
