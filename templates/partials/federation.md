## Federation

- **Network:** {{ federation.network }}{{ #if federation.role }} (role: {{ federation.role }}){{ /if }}
- **Upstream:** {{ federation.upstream }} (framework version pinned: {{ federation.framework_version }})
{{ #if federation.peers }}
- **Peers:**
{{ #each federation.peers }}
  - {{ . }}
{{ /each }}
{{ /if }}
{{ #if federation.downstream }}
- **Downstream instances:**
{{ #each federation.downstream }}
  - {{ . }}
{{ /each }}
{{ /if }}
