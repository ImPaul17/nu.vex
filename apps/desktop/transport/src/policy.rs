use serde_json::Value;
use url::Url;
use uuid::Uuid;

use crate::{TransportError, MAX_REQUEST};

pub fn origin(input: &str, allow_loopback: bool) -> Result<Url, TransportError> {
    if input.is_empty()
        || input.len() > 2048
        || input.trim() != input
        || input.bytes().any(|c| c.is_ascii_control())
        || input.contains(['@', '\\', '?', '#', '*', '%'])
    {
        return Err(TransportError::invalid(
            "La dirección de la instancia no es válida.",
        ));
    }
    let value = Url::parse(input)
        .map_err(|_| TransportError::invalid("La dirección de la instancia no es válida."))?;
    let authority = input
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or_default();
    if authority.is_empty()
        || authority.contains('/')
        || !value.username().is_empty()
        || value.password().is_some()
        || value.host_str().is_none()
        || value.cannot_be_a_base()
    {
        return Err(TransportError::invalid(
            "Introduce el origen de la instancia sin ruta ni credenciales.",
        ));
    }
    let local = matches!(
        value.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if value.scheme() != "https" && !(allow_loopback && value.scheme() == "http" && local) {
        return Err(TransportError::invalid("La instancia debe usar HTTPS. HTTP local sólo está permitido en compilaciones de desarrollo."));
    }
    if value
        .host_str()
        .is_some_and(|host| host == "." || host.ends_with('.'))
        || authority.ends_with(':')
    {
        return Err(TransportError::invalid(
            "El servidor de la instancia no es válido.",
        ));
    }
    Ok(value)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Public,
    Auth,
    Protected,
    Logout,
}

pub struct Route {
    pub kind: Kind,
    pub body: Option<Value>,
}

fn uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
fn bounded(value: Option<&Value>, limit: usize) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty() && value.chars().count() <= limit)
}

pub fn route(path: &str, method: &str, body: Option<&str>) -> Result<Route, TransportError> {
    if path.len() > 2048
        || !path.starts_with('/')
        || path.contains(['%', '\\', '#'])
        || path
            .bytes()
            .any(|c| c.is_ascii_control() || c.is_ascii_whitespace())
        || body.is_some_and(|body| body.len() > MAX_REQUEST)
    {
        return Err(TransportError::invalid(
            "La solicitud a la instancia no es válida.",
        ));
    }
    let (pathname, query) = path
        .split_once('?')
        .map_or((path, None), |(path, query)| (path, Some(query)));
    let segments: Vec<_> = pathname[1..].split('/').collect();
    let kind = match (method, segments.as_slice()) {
        ("GET", ["instance"]) => Kind::Public,
        ("POST", ["auth", "login" | "register"]) => Kind::Auth,
        ("POST", ["auth", "logout"]) => Kind::Logout,
        ("GET", ["auth", "me"] | ["bootstrap"]) => Kind::Protected,
        ("POST", ["communities"]) => Kind::Protected,
        ("POST", ["communities", id, "channels" | "invites"]) if uuid(id) => Kind::Protected,
        ("POST", ["invites", code, "join"])
            if code.len() == 32 && code.bytes().all(|c| c.is_ascii_hexdigit()) =>
        {
            Kind::Protected
        }
        ("GET" | "POST", ["channels", id, "messages"]) if uuid(id) => Kind::Protected,
        (
            "POST",
            ["channels", id, "voice", "join" | "state" | "signal" | "leave" | "heartbeat"],
        ) if uuid(id) => Kind::Protected,
        ("DELETE", ["channels", channel, "messages", message])
            if uuid(channel) && uuid(message) =>
        {
            Kind::Protected
        }
        _ => return Err(TransportError::invalid("Esta operación no está permitida.")),
    };
    if let Some(query) = query {
        if method != "GET" || !matches!(segments.as_slice(), ["channels", _, "messages"]) {
            return Err(TransportError::invalid(
                "Esta operación no admite parámetros de consulta.",
            ));
        }
        let valid =
            query == "limit=100" || query.strip_prefix("limit=100&before=").is_some_and(uuid);
        if !valid {
            return Err(TransportError::invalid(
                "La posición del historial no es válida.",
            ));
        }
    }
    let mut parsed = body
        .map(|value| {
            serde_json::from_str::<Value>(value)
                .map_err(|_| TransportError::invalid("La solicitud debe contener un objeto JSON."))
        })
        .transpose()?;
    if let ["channels", _, "voice", action] = segments.as_slice() {
        validate_voice_body(action, parsed.as_ref())?;
        return Ok(Route { kind, body: parsed });
    }
    let fields: &[&str] = match (method, segments.as_slice()) {
        ("POST", ["auth", "login"]) => &["email", "password", "transport"],
        ("POST", ["auth", "register"]) => {
            &["email", "password", "displayName", "handle", "transport"]
        }
        ("POST", ["communities"]) => &["name"],
        ("POST", ["communities", _, "channels"]) => &["name", "kind"],
        ("POST", ["channels", _, "messages"]) => &["content", "clientId"],
        _ => &[],
    };
    if fields.is_empty() {
        if parsed.is_some() {
            return Err(TransportError::invalid(
                "Esta operación no admite contenido.",
            ));
        }
    } else {
        let object = parsed
            .as_mut()
            .and_then(Value::as_object_mut)
            .ok_or_else(|| TransportError::invalid("La solicitud debe contener un objeto JSON."))?;
        if object.keys().any(|key| !fields.contains(&key.as_str())) {
            return Err(TransportError::invalid(
                "La solicitud contiene un campo desconocido.",
            ));
        }
        if kind == Kind::Auth {
            if !bounded(object.get("email"), 254)
                || !bounded(object.get("password"), 512)
                || (segments[1] == "register"
                    && (!bounded(object.get("displayName"), 80)
                        || !bounded(object.get("handle"), 32)))
            {
                return Err(TransportError::invalid(
                    "Los datos de acceso no son válidos.",
                ));
            }
            object.insert("transport".into(), Value::String("bearer".into()));
        } else if object.contains_key("name") {
            let limit = if segments.len() == 3 { 40 } else { 80 };
            if !bounded(object.get("name"), limit) {
                return Err(TransportError::invalid("El nombre no es válido."));
            }
            if object
                .get("kind")
                .is_some_and(|kind| !matches!(kind.as_str(), Some("text" | "voice")))
            {
                return Err(TransportError::invalid("El tipo de canal no es válido."));
            }
        } else if !bounded(object.get("content"), 4000)
            || !object
                .get("clientId")
                .and_then(Value::as_str)
                .is_some_and(uuid)
        {
            return Err(TransportError::invalid("El mensaje no es válido."));
        }
    }
    Ok(Route { kind, body: parsed })
}

fn validate_voice_body(action: &str, body: Option<&Value>) -> Result<(), TransportError> {
    let invalid = || TransportError::invalid("La operación de voz no es válida.");
    let object = body.and_then(Value::as_object).ok_or_else(invalid)?;
    let fields: &[&str] = match action {
        "join" => &[],
        "state" => &["participantId", "muted", "deafened"],
        "signal" => &["participantId", "targetId", "signal"],
        "leave" | "heartbeat" => &["participantId"],
        _ => return Err(invalid()),
    };
    if object.keys().any(|key| !fields.contains(&key.as_str())) {
        return Err(invalid());
    }
    if action == "join" {
        return Ok(());
    }
    if !object
        .get("participantId")
        .and_then(Value::as_str)
        .is_some_and(uuid)
    {
        return Err(invalid());
    }
    if action == "state"
        && (!object.get("muted").is_some_and(Value::is_boolean)
            || !object.get("deafened").is_some_and(Value::is_boolean))
    {
        return Err(invalid());
    }
    if action != "signal" {
        return Ok(());
    }
    if !object
        .get("targetId")
        .and_then(Value::as_str)
        .is_some_and(uuid)
    {
        return Err(invalid());
    }
    let signal = object
        .get("signal")
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    match signal.get("type").and_then(Value::as_str) {
        Some("offer" | "answer") => {
            if signal
                .keys()
                .any(|key| !["type", "sdp"].contains(&key.as_str()))
                || !bounded(signal.get("sdp"), 16_384)
            {
                return Err(invalid());
            }
        }
        Some("candidate") => {
            if signal
                .keys()
                .any(|key| !["type", "candidate"].contains(&key.as_str()))
            {
                return Err(invalid());
            }
            let candidate = signal.get("candidate").ok_or_else(invalid)?;
            if candidate.is_null() {
                return Ok(());
            }
            let candidate = candidate.as_object().ok_or_else(invalid)?;
            if candidate.keys().any(|key| {
                !["candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"]
                    .contains(&key.as_str())
            }) || !candidate
                .get("candidate")
                .and_then(Value::as_str)
                .is_some_and(|value| value.len() <= 4096)
                || ["sdpMid", "usernameFragment"].into_iter().any(|key| {
                    candidate.get(key).is_some_and(|value| {
                        !value.is_null() && !value.as_str().is_some_and(|text| text.len() <= 256)
                    })
                })
                || candidate.get("sdpMLineIndex").is_some_and(|value| {
                    !value.is_null() && !value.as_u64().is_some_and(|index| index <= 65535)
                })
            {
                return Err(invalid());
            }
        }
        _ => return Err(invalid()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn voice_routes_validate_exact_operations_and_bounded_signals() {
        let id = "99e7934a-97c8-40fc-9ce0-f21915ecc883";
        let join = format!("/channels/{id}/voice/join");
        assert!(route(&join, "POST", Some("{}")).is_ok());
        assert!(route(&join, "GET", None).is_err());
        assert!(route(&join, "POST", Some(r#"{"url":"https://other.test"}"#)).is_err());
        assert!(route(&format!("/channels/{id}/voice/unknown"), "POST", Some("{}")).is_err());
        let state = serde_json::json!({"participantId":id,"muted":true,"deafened":false});
        assert!(route(
            &format!("/channels/{id}/voice/state"),
            "POST",
            Some(&state.to_string())
        )
        .is_ok());
        let state = serde_json::json!({"participantId":id,"muted":"true","deafened":false});
        assert!(route(
            &format!("/channels/{id}/voice/state"),
            "POST",
            Some(&state.to_string())
        )
        .is_err());
        let signal = serde_json::json!({"participantId":id,"targetId":id,"signal":{"type":"offer","sdp":"v=0\r\n"}});
        assert!(route(
            &format!("/channels/{id}/voice/signal"),
            "POST",
            Some(&signal.to_string())
        )
        .is_ok());
        let signal = serde_json::json!({"participantId":id,"targetId":id,"signal":{"type":"offer","sdp":"x".repeat(16_385)}});
        assert!(route(
            &format!("/channels/{id}/voice/signal"),
            "POST",
            Some(&signal.to_string())
        )
        .is_err());
        let signal = serde_json::json!({"participantId":id,"targetId":id,"signal":{"type":"candidate","candidate":{"candidate":"candidate:1","sdpMid":"0","sdpMLineIndex":0,"usernameFragment":"abc"}}});
        assert!(route(
            &format!("/channels/{id}/voice/signal"),
            "POST",
            Some(&signal.to_string())
        )
        .is_ok());
        assert!(route(
            &format!("/communities/{id}/channels"),
            "POST",
            Some(r#"{"name":"charla","kind":"voice"}"#)
        )
        .is_ok());
        assert!(route(
            &format!("/communities/{id}/channels"),
            "POST",
            Some(r#"{"name":"charla","kind":"video"}"#)
        )
        .is_err());
    }
    #[test]
    fn origins_are_exact_and_debug_http_is_loopback_only() {
        assert_eq!(
            origin("https://CHAT.example:443", false)
                .unwrap()
                .origin()
                .ascii_serialization(),
            "https://chat.example"
        );
        for bad in [
            "https://user@host",
            "https://host/",
            "https://host/..",
            "https://host?",
            "https://host#",
            "https://host\\path",
            "https://*.host",
            "http://127.0.0.1:3001",
            "https://127.0.0.999",
            "https://host:65536",
        ] {
            assert!(origin(bad, false).is_err(), "{bad}");
        }
        assert!(origin("http://127.0.0.1:3001", true).is_ok());
        assert!(origin("http://public.example", true).is_err());
    }
    #[test]
    fn routes_reject_encoded_paths_queries_and_noncanonical_ids() {
        let id = "99e7934a-97c8-40fc-9ce0-f21915ecc883";
        assert!(route(
            &format!("/channels/{id}/messages?limit=100&before={id}"),
            "GET",
            None
        )
        .is_ok());
        for path in [
            "//instance",
            "/../instance",
            "/%69nstance",
            "/instance?",
            "/instance?url=https://evil",
            "/channels/not-a-uuid/messages",
            "/events/ticket",
            "/auth/login#x",
            "/channels/99E7934A-97C8-40FC-9CE0-F21915ECC883/messages",
        ] {
            assert!(route(path, "GET", None).is_err(), "{path}");
        }
        assert!(route("/instance", "PUT", None).is_err());
        assert!(route(
            "/auth/login",
            "POST",
            Some(r#"{"email":"a@b.test","password":"long-password","headers":{}}"#)
        )
        .is_err());
        let auth = route(
            "/auth/login",
            "POST",
            Some(r#"{"email":"a@b.test","password":"long-password","transport":"cookie"}"#),
        )
        .unwrap();
        assert_eq!(auth.body.unwrap()["transport"], "bearer");
    }
}
