use axum::http::Uri;
use std::{env, net::SocketAddr};

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub bind: SocketAddr,
    pub allowed_origin: String,
    pub insecure_dev: bool,
    pub registration_open: bool,
    pub migrate_on_start: bool,
    pub instance_name: String,
    pub trusted_proxies: Vec<ipnet::IpNet>,
    pub voice_ice_servers: Vec<crate::voice::IceServer>,
}

fn flag(name: &str) -> Result<bool, String> {
    match env::var(name).as_deref() {
        Ok("true") => Ok(true),
        Ok("false") | Err(_) => Ok(false),
        _ => Err(format!("{name} must be true or false")),
    }
}

pub fn validate_origin(origin: &str, insecure_dev: bool) -> Result<(), String> {
    let uri: Uri = origin
        .parse()
        .map_err(|_| "NUVEX_ALLOWED_ORIGIN is invalid")?;
    let scheme = uri.scheme_str().unwrap_or_default();
    let host = uri.host().unwrap_or_default();
    if uri.authority().is_none()
        || uri
            .path_and_query()
            .is_some_and(|value| value.as_str() != "/")
        || origin.ends_with('/')
        || uri
            .authority()
            .is_some_and(|value| value.as_str().contains('@'))
    {
        return Err("NUVEX_ALLOWED_ORIGIN must be an exact origin without path, user information or trailing slash".into());
    }
    if insecure_dev {
        if scheme != "http" || !matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1") {
            return Err("NUVEX_INSECURE_DEV permits only an HTTP loopback browser origin".into());
        }
    } else if scheme != "https" {
        return Err(
            "HTTPS is required; HTTP loopback development requires NUVEX_INSECURE_DEV=true".into(),
        );
    }
    Ok(())
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let insecure_dev = flag("NUVEX_INSECURE_DEV")?;
        let database_url =
            env::var("NUVEX_DATABASE_URL").map_err(|_| "NUVEX_DATABASE_URL is required")?;
        if !database_url.starts_with("postgres://") && !database_url.starts_with("postgresql://") {
            return Err("NUVEX_DATABASE_URL must use PostgreSQL".into());
        }
        let allowed_origin = env::var("NUVEX_ALLOWED_ORIGIN")
            .or_else(|_| {
                if insecure_dev {
                    Ok("http://127.0.0.1:5173".into())
                } else {
                    Err(env::VarError::NotPresent)
                }
            })
            .map_err(|_| "NUVEX_ALLOWED_ORIGIN is required")?;
        validate_origin(&allowed_origin, insecure_dev)?;
        let bind = env::var("NUVEX_BIND")
            .unwrap_or_else(|_| "127.0.0.1:3001".into())
            .parse()
            .map_err(|_| "NUVEX_BIND must be an IP address and port")?;
        let instance_name = env::var("NUVEX_INSTANCE_NAME").unwrap_or_else(|_| "nu.vex".into());
        if instance_name.trim().is_empty() || instance_name.chars().count() > 80 {
            return Err("NUVEX_INSTANCE_NAME must contain 1..80 characters".into());
        }
        let trusted_proxies =
            parse_trusted_proxies(&env::var("NUVEX_TRUSTED_PROXIES").unwrap_or_default())?;
        Ok(Self {
            database_url,
            bind,
            allowed_origin,
            insecure_dev,
            registration_open: flag("NUVEX_REGISTRATION_OPEN")?,
            migrate_on_start: flag("NUVEX_MIGRATE_ON_START")?,
            instance_name,
            trusted_proxies,
            voice_ice_servers: crate::voice::parse_ice_servers(
                env::var("NUVEX_VOICE_ICE_SERVERS").ok().as_deref(),
            )?,
        })
    }
}

pub fn parse_trusted_proxies(value: &str) -> Result<Vec<ipnet::IpNet>, String> {
    let mut networks = Vec::new();
    for value in value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let network: ipnet::IpNet = value
            .parse()
            .map_err(|_| "NUVEX_TRUSTED_PROXIES must contain comma-separated CIDRs")?;
        if network.prefix_len() == 0 || networks.len() >= 32 {
            return Err(
                "NUVEX_TRUSTED_PROXIES must contain at most 32 explicit networks; /0 is forbidden"
                    .into(),
            );
        }
        networks.push(network.trunc());
    }
    Ok(networks)
}

#[cfg(test)]
mod tests {
    use super::validate_origin;
    #[test]
    fn insecure_origin_is_strictly_loopback() {
        for origin in [
            "http://127.0.0.1:5173",
            "http://localhost:8080",
            "http://[::1]:5173",
        ] {
            assert!(validate_origin(origin, true).is_ok(), "{origin}");
        }
        for origin in [
            "http://example.com",
            "http://127.0.0.1.evil.test",
            "https://example.com",
            "null",
            "http://localhost:5173/",
            "http://localhost/path",
            "http://user@localhost",
        ] {
            assert!(validate_origin(origin, true).is_err(), "{origin}");
        }
        assert!(validate_origin("https://chat.example.org", false).is_ok());
        assert!(validate_origin("http://chat.example.org", false).is_err());
    }
    #[test]
    fn trusted_proxy_networks_are_explicit_and_bounded() {
        assert!(super::parse_trusted_proxies("").unwrap().is_empty());
        assert_eq!(
            super::parse_trusted_proxies("127.0.0.1/32, ::1/128")
                .unwrap()
                .len(),
            2
        );
        for value in ["0.0.0.0/0", "::/0", "localhost", "invalid/24"] {
            assert!(super::parse_trusted_proxies(value).is_err());
        }
        assert!(super::parse_trusted_proxies(&vec!["127.0.0.1/32"; 33].join(",")).is_err());
    }
}
