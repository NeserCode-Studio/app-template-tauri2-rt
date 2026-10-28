use std::sync::Arc;

use rmcp::model::{Prompt, PromptArgument, Resource, ResourceTemplate, Tool, ToolAnnotations};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolAnnotationsManifest {
    pub read_only_hint: Option<bool>,
    pub destructive_hint: Option<bool>,
    pub idempotent_hint: Option<bool>,
    pub open_world_hint: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolManifestEntry {
    pub name: String,
    pub title: String,
    pub description: String,
    pub input_schema: Value,
    pub output_schema: Option<Value>,
    #[serde(default)]
    pub annotations: ToolAnnotationsManifest,
    pub permission: String,
    pub risk: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceManifestEntry {
    pub uri: String,
    pub name: String,
    pub title: String,
    pub description: String,
    pub mime_type: String,
    pub permission: String,
    pub risk: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PromptArgumentManifest {
    pub name: String,
    pub description: String,
    pub required: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PromptManifestEntry {
    pub name: String,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub arguments: Vec<PromptArgumentManifest>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpManifest {
    pub protocol_version: String,
    pub compatible_versions: Vec<String>,
    pub access_level: String,
    pub tools: Vec<ToolManifestEntry>,
    pub resources: Vec<ResourceManifestEntry>,
    pub prompts: Vec<PromptManifestEntry>,
}

impl McpManifest {
    pub fn validate(&self) -> Result<(), String> {
        if self.protocol_version.trim().is_empty() {
            return Err("protocolVersion is empty".into());
        }
        if self.compatible_versions.is_empty() {
            return Err("compatibleVersions is empty".into());
        }
        if !is_permission(&self.access_level) {
            return Err(format!("unknown access level: {}", self.access_level));
        }
        let mut tool_names = std::collections::HashSet::new();
        for tool in &self.tools {
            if !tool.name.starts_with("novels_") {
                return Err(format!("tool name must use novels_ prefix: {}", tool.name));
            }
            if !is_permission(&tool.permission) {
                return Err(format!("tool {} has an unknown permission", tool.name));
            }
            if !is_risk(&tool.risk) {
                return Err(format!("tool {} has an unknown risk", tool.name));
            }
            if !tool.input_schema.is_object() {
                return Err(format!("tool {} inputSchema must be an object", tool.name));
            }
            if tool.annotations.read_only_hint == Some(true) {
                let response_format = tool
                    .input_schema
                    .get("properties")
                    .and_then(|properties| properties.get("response_format"))
                    .ok_or_else(|| {
                        format!("read-only tool {} must expose response_format", tool.name)
                    })?;
                let values = response_format
                    .get("enum")
                    .and_then(Value::as_array)
                    .ok_or_else(|| {
                        format!(
                            "read-only tool {} response_format must declare an enum",
                            tool.name
                        )
                    })?;
                if !values.iter().any(|value| value == "json")
                    || !values.iter().any(|value| value == "markdown")
                {
                    return Err(format!(
                        "read-only tool {} response_format must support json and markdown",
                        tool.name
                    ));
                }
            }
            if !tool_names.insert(tool.name.clone()) {
                return Err(format!("duplicate tool name: {}", tool.name));
            }
        }
        Ok(())
    }

    pub fn tool(&self, name: &str) -> Option<&ToolManifestEntry> {
        self.tools.iter().find(|tool| tool.name == name)
    }

    pub fn tools_for_permission(&self) -> impl Iterator<Item = &ToolManifestEntry> {
        self.tools
            .iter()
            .filter(|tool| permission_allows(&self.access_level, &tool.permission))
    }

    pub fn resources_for_permission(&self) -> impl Iterator<Item = &ResourceManifestEntry> {
        self.resources
            .iter()
            .filter(|resource| permission_allows(&self.access_level, &resource.permission))
    }

    pub fn concrete_resources(&self) -> impl Iterator<Item = &ResourceManifestEntry> {
        self.resources_for_permission()
            .filter(|resource| !resource.uri.contains('{'))
    }

    pub fn resource_templates(&self) -> impl Iterator<Item = &ResourceManifestEntry> {
        self.resources_for_permission()
            .filter(|resource| resource.uri.contains('{'))
    }

    pub fn rmcp_tool(&self, name: &str) -> Option<Tool> {
        let tool = self.tool(name)?;
        if !permission_allows(&self.access_level, &tool.permission) {
            return None;
        }
        let schema = tool.input_schema.as_object()?.clone();
        let annotations = ToolAnnotations::from_raw(
            Some(tool.title.clone()),
            tool.annotations.read_only_hint,
            tool.annotations.destructive_hint,
            tool.annotations.idempotent_hint,
            tool.annotations.open_world_hint,
        );
        let mut result = Tool::new(
            tool.name.clone(),
            tool.description.clone(),
            Arc::new(schema),
        )
        .with_title(tool.title.clone())
        .with_annotations(annotations);
        if let Some(output) = tool.output_schema.as_ref().and_then(Value::as_object) {
            result = result.with_raw_output_schema(Arc::new(output.clone()));
        }
        Some(result)
    }

    pub fn rmcp_resources(&self) -> Vec<Resource> {
        self.concrete_resources()
            .map(|resource| {
                Resource::new(resource.uri.clone(), resource.name.clone())
                    .with_title(resource.title.clone())
                    .with_description(resource.description.clone())
                    .with_mime_type(resource.mime_type.clone())
            })
            .collect()
    }

    pub fn rmcp_resource_templates(&self) -> Vec<ResourceTemplate> {
        self.resource_templates()
            .map(|resource| {
                ResourceTemplate::new(resource.uri.clone(), resource.name.clone())
                    .with_title(resource.title.clone())
                    .with_description(resource.description.clone())
                    .with_mime_type(resource.mime_type.clone())
            })
            .collect()
    }

    pub fn rmcp_prompts(&self) -> Vec<Prompt> {
        self.prompts
            .iter()
            .map(|prompt| {
                let arguments = prompt
                    .arguments
                    .iter()
                    .map(|argument| {
                        PromptArgument::new(argument.name.clone())
                            .with_description(argument.description.clone())
                            .with_required(argument.required)
                    })
                    .collect::<Vec<_>>();
                Prompt::new(
                    prompt.name.clone(),
                    Some(prompt.description.clone()),
                    Some(arguments),
                )
                .with_title(prompt.title.clone())
            })
            .collect()
    }

    pub fn prompt(&self, name: &str) -> Option<&PromptManifestEntry> {
        self.prompts.iter().find(|prompt| prompt.name == name)
    }
}

pub fn permission_rank(value: &str) -> Option<u8> {
    match value {
        "read" => Some(0),
        "write" => Some(1),
        "admin" => Some(2),
        _ => None,
    }
}

pub fn permission_allows(granted: &str, required: &str) -> bool {
    match (permission_rank(granted), permission_rank(required)) {
        (Some(granted), Some(required)) => granted >= required,
        _ => false,
    }
}

pub fn is_permission(value: &str) -> bool {
    permission_rank(value).is_some()
}

pub fn is_risk(value: &str) -> bool {
    matches!(value, "R0" | "R1" | "R2" | "R3")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn manifest() -> McpManifest {
        McpManifest {
            protocol_version: "2026-07-28".into(),
            compatible_versions: vec!["2026-07-28".into()],
            access_level: "read".into(),
            tools: vec![ToolManifestEntry {
                name: "novels_workspace_get".into(),
                title: "Get workspace".into(),
                description: "Read workspace".into(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "response_format": {
                            "type": "string",
                            "enum": ["json", "markdown"],
                            "default": "json"
                        }
                    }
                }),
                output_schema: None,
                annotations: ToolAnnotationsManifest {
                    read_only_hint: Some(true),
                    ..Default::default()
                },
                permission: "read".into(),
                risk: "R0".into(),
            }],
            resources: vec![],
            prompts: vec![],
        }
    }

    #[test]
    fn validates_and_filters_permissions() {
        let mut value = manifest();
        assert!(value.validate().is_ok());
        assert!(value.rmcp_tool("novels_workspace_get").is_some());
        value.access_level = "read".into();
        value.tools[0].permission = "write".into();
        assert!(value.rmcp_tool("novels_workspace_get").is_none());
    }

    #[test]
    fn rejects_duplicate_tool_names() {
        let mut value = manifest();
        value.tools.push(value.tools[0].clone());
        assert!(value.validate().is_err());
    }

    #[test]
    fn read_only_tools_must_expose_both_response_formats() {
        let mut value = manifest();
        value.tools[0].input_schema = json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {}
        });
        assert!(value.validate().is_err());
    }
}
