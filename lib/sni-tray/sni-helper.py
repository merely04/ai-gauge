#!/usr/bin/env python3
"""AI Gauge SNI helper.

JSONL IPC contract: `lib/sni-tray/IPC.md`
SNI spec: https://specifications.freedesktop.org/status-notifier-item/latest-single
DBusMenu spec: https://github.com/gnustep/libs-dbuskit/blob/master/Bundles/DBusMenu/com.canonical.dbusmenu.xml

Wave 1:
- `AIGAUGE_SNI_TEST_MODE=1` short-circuits before any dbus/gi import.
- Tries `dbus-python` first; falls back to a GLib/GDBus backend gated by
  `dasbus` availability.
"""

import json
import os
import signal
import sys
import threading
from hashlib import sha1

__version__ = "1.0.0"

TEST_MODE = os.environ.get("AIGAUGE_SNI_TEST_MODE") == "1"
MAX_LINE_BYTES = 1024 * 1024
SNI_PATH = "/StatusNotifierItem"
MENU_PATH = "/MenuBar"
SNI_IFACE = "org.kde.StatusNotifierItem"
MENU_IFACE = "com.canonical.dbusmenu"
PROPS_IFACE = "org.freedesktop.DBus.Properties"
INTRO_IFACE = "org.freedesktop.DBus.Introspectable"
WATCHER_PATH = "/StatusNotifierWatcher"
WATCHERS = (
    "org.kde.StatusNotifierWatcher",
    "org.freedesktop.StatusNotifierWatcher",
)
ICON_THEME_PATH = os.path.expanduser("~/.local/share/icons")
VALID_ICONS = {
    "ai-gauge-normal",
    "ai-gauge-waiting",
    "ai-gauge-warning",
    "ai-gauge-critical",
    "ai-gauge-update-available",
    "ai-gauge-updating",
}
VALID_STATUSES = {"Active", "Passive", "NeedsAttention"}
VALID_COMMANDS = {"init", "set-icon", "set-status", "set-tooltip", "set-menu", "shutdown"}

SNI_XML = """<node><interface name="org.kde.StatusNotifierItem"><property name="Category" type="s" access="read"/><property name="Id" type="s" access="read"/><property name="Title" type="s" access="read"/><property name="Status" type="s" access="read"/><property name="WindowId" type="u" access="read"/><property name="IconName" type="s" access="read"/><property name="IconPixmap" type="a(iiay)" access="read"/><property name="OverlayIconName" type="s" access="read"/><property name="OverlayIconPixmap" type="a(iiay)" access="read"/><property name="AttentionIconName" type="s" access="read"/><property name="AttentionIconPixmap" type="a(iiay)" access="read"/><property name="AttentionMovieName" type="s" access="read"/><property name="ToolTip" type="(sa(iiay)ss)" access="read"/><property name="ItemIsMenu" type="b" access="read"/><property name="Menu" type="o" access="read"/><property name="IconThemePath" type="s" access="read"/><method name="Activate"><arg name="x" type="i" direction="in"/><arg name="y" type="i" direction="in"/></method><method name="SecondaryActivate"><arg name="x" type="i" direction="in"/><arg name="y" type="i" direction="in"/></method><method name="ContextMenu"><arg name="x" type="i" direction="in"/><arg name="y" type="i" direction="in"/></method><method name="Scroll"><arg name="delta" type="i" direction="in"/><arg name="orientation" type="s" direction="in"/></method><signal name="NewTitle"/><signal name="NewIcon"/><signal name="NewAttentionIcon"/><signal name="NewOverlayIcon"/><signal name="NewToolTip"/><signal name="NewStatus"><arg name="status" type="s"/></signal></interface><interface name="org.freedesktop.DBus.Properties"><method name="Get"><arg name="interface_name" type="s" direction="in"/><arg name="property_name" type="s" direction="in"/><arg name="value" type="v" direction="out"/></method><method name="GetAll"><arg name="interface_name" type="s" direction="in"/><arg name="properties" type="a{sv}" direction="out"/></method><method name="Set"><arg name="interface_name" type="s" direction="in"/><arg name="property_name" type="s" direction="in"/><arg name="value" type="v" direction="in"/></method><signal name="PropertiesChanged"><arg name="interface_name" type="s"/><arg name="changed_properties" type="a{sv}"/><arg name="invalidated_properties" type="as"/></signal></interface><interface name="org.freedesktop.DBus.Introspectable"><method name="Introspect"><arg name="xml_data" type="s" direction="out"/></method></interface></node>"""
MENU_XML = """<node><interface name="com.canonical.dbusmenu"><property name="Version" type="u" access="read"/><property name="TextDirection" type="s" access="read"/><property name="Status" type="s" access="read"/><method name="GetLayout"><arg name="parentId" type="i" direction="in"/><arg name="recursionDepth" type="i" direction="in"/><arg name="propertyNames" type="as" direction="in"/><arg name="revision" type="u" direction="out"/><arg name="layout" type="(ia{sv}av)" direction="out"/></method><method name="GetGroupProperties"><arg name="ids" type="ai" direction="in"/><arg name="propertyNames" type="as" direction="in"/><arg name="properties" type="a(ia{sv})" direction="out"/></method><method name="GetProperty"><arg name="id" type="i" direction="in"/><arg name="name" type="s" direction="in"/><arg name="value" type="v" direction="out"/></method><method name="Event"><arg name="id" type="i" direction="in"/><arg name="eventId" type="s" direction="in"/><arg name="data" type="v" direction="in"/><arg name="timestamp" type="u" direction="in"/></method><method name="EventGroup"><arg name="events" type="a(isvu)" direction="in"/><arg name="idErrors" type="ai" direction="out"/></method><method name="AboutToShow"><arg name="id" type="i" direction="in"/><arg name="needUpdate" type="b" direction="out"/></method><method name="AboutToShowGroup"><arg name="ids" type="ai" direction="in"/><arg name="updatesNeeded" type="ai" direction="out"/><arg name="idErrors" type="ai" direction="out"/></method><signal name="ItemsPropertiesUpdated"><arg name="updatedProps" type="a(ia{sv})"/><arg name="removedProps" type="a(ias)"/></signal><signal name="LayoutUpdated"><arg name="revision" type="u"/><arg name="parent" type="i"/></signal><signal name="ItemActivationRequested"><arg name="id" type="i"/><arg name="timestamp" type="u"/></signal></interface><interface name="org.freedesktop.DBus.Properties"><method name="Get"><arg name="interface_name" type="s" direction="in"/><arg name="property_name" type="s" direction="in"/><arg name="value" type="v" direction="out"/></method><method name="GetAll"><arg name="interface_name" type="s" direction="in"/><arg name="properties" type="a{sv}" direction="out"/></method><method name="Set"><arg name="interface_name" type="s" direction="in"/><arg name="property_name" type="s" direction="in"/><arg name="value" type="v" direction="in"/></method><signal name="PropertiesChanged"><arg name="interface_name" type="s"/><arg name="changed_properties" type="a{sv}"/><arg name="invalidated_properties" type="as"/></signal></interface><interface name="org.freedesktop.DBus.Introspectable"><method name="Introspect"><arg name="xml_data" type="s" direction="out"/></method></interface></node>"""


class Writer:
    def __init__(self):
        self.lock = threading.Lock()
    def send(self, payload):
        line = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        with self.lock:
            sys.stdout.write(line)
            sys.stdout.write("\n")
            sys.stdout.flush()

def eprint(msg):
    sys.stderr.write(str(msg) + "\n")
    sys.stderr.flush()

def shash(obj):
    text = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha1(text.encode("utf-8")).hexdigest()

def ensure_string(value, field):
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    return value

def ensure_bool(value, field, default=True):
    if value is None:
        return default
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be a boolean")
    return value


class MenuModel:
    def __init__(self):
        self.revision = 1
        self.next_id = 1
        self.path_map = {}
        self.id_map = {0: self._node(0, None, {}, [], "root", True, True)}
        self.logical_map = {}
        self.layout_sig = "root"
    def _node(self, nid, lid, props, children, kind, enabled, visible):
        return {
            "nid": nid,
            "lid": lid,
            "props": props,
            "children": children,
            "kind": kind,
            "enabled": enabled,
            "visible": visible,
        }
    def _alloc(self, path):
        if path not in self.path_map:
            self.path_map[path] = self.next_id
            self.next_id += 1
        return self.path_map[path]
    def _layout_sig_for(self, node):
        children = [self._layout_sig_for(child) for child in node["children"]]
        return f"{node['nid']}:{node['lid']}:{node['kind']}:{children}"
    def _index(self, node):
        self.id_map[node["nid"]] = node
        if node["lid"]:
            self.logical_map[node["lid"]] = node["nid"]
        for child in node["children"]:
            self._index(child)
    def _build(self, item, path):
        if not isinstance(item, dict):
            raise ValueError("menu item must be an object")
        kind = item.get("type", "")
        if kind not in ("", "separator", "menu"):
            raise ValueError(f"invalid menu item type: {kind}")
        nid = self._alloc(path)
        lid = item.get("id")
        label = item.get("label", "")
        if lid is not None and not isinstance(lid, str):
            raise ValueError("menu item id must be a string")
        if not isinstance(label, str):
            raise ValueError("menu item label must be a string")
        enabled = ensure_bool(item.get("enabled"), "enabled", True)
        visible = ensure_bool(item.get("visible"), "visible", True)
        if kind == "separator":
            return self._node(nid, lid, {"type": "separator"}, [], "separator", enabled, visible)
        props = {"label": label, "enabled": enabled, "visible": visible}
        children = []
        icon = item.get("icon")
        if icon is not None:
            props["icon-name"] = ensure_string(icon, "icon")
        toggle_type = item.get("toggleType")
        if toggle_type is not None:
            if toggle_type not in ("checkmark", "radio"):
                raise ValueError(f"invalid toggleType: {toggle_type}")
            props["toggle-type"] = toggle_type
        toggle_state = item.get("toggleState")
        if toggle_state is not None:
            if toggle_state not in (0, 1):
                raise ValueError("toggleState must be 0 or 1")
            props["toggle-state"] = int(toggle_state)
        if kind == "menu":
            props["children-display"] = "submenu"
            raw_children = item.get("children", [])
            if not isinstance(raw_children, list):
                raise ValueError("menu children must be an array")
            children = [self._build(child, f"{path}/{index}") for index, child in enumerate(raw_children)]
        return self._node(nid, lid, props, children, kind or "standard", enabled, visible)
    def set_items(self, items):
        old_props = {nid: dict(node["props"]) for nid, node in self.id_map.items() if nid}
        old_sig = self.layout_sig
        root = self.id_map[0]
        root["children"] = [self._build(item, f"root/{index}") for index, item in enumerate(items)]
        self.id_map = {0: root}
        self.logical_map = {}
        self._index(root)
        self.layout_sig = self._layout_sig_for(root)
        new_props = {nid: dict(node["props"]) for nid, node in self.id_map.items() if nid}
        updated = []
        removed = []
        for nid, props in sorted(new_props.items()):
            if nid not in old_props:
                updated.append((nid, props))
                continue
            delta = {key: value for key, value in props.items() if old_props[nid].get(key) != value}
            gone = [key for key in old_props[nid] if key not in props]
            if delta:
                updated.append((nid, delta))
            if gone:
                removed.append((nid, gone))

        for nid in sorted(set(old_props) - set(new_props)):
            removed.append((nid, sorted(old_props[nid].keys())))

        layout_changed = old_sig != self.layout_sig or set(old_props) != set(new_props)
        if updated or removed or layout_changed:
            self.revision += 1
        return updated, removed, layout_changed
    def node(self, nid):
        return self.id_map.get(int(nid))
    def logical(self, nid):
        node = self.node(nid)
        return node and node["lid"]
    def clickable(self, nid):
        node = self.node(nid)
        if not node or not node["lid"]:
            return False
        if node["kind"] in ("separator", "menu"):
            return False
        if not node["enabled"] or not node["visible"]:
            return False
        return not node["lid"].startswith("info:")
    def _props(self, props, names):
        if not names:
            return dict(props)
        wanted = set(names)
        return {key: value for key, value in props.items() if key in wanted}
    def layout(self, parent_id, depth, names):
        node = self.node(parent_id) or self.id_map[0]
        return self._layout(node, depth, names)
    def _layout(self, node, depth, names):
        if depth == 0:
            return (node["nid"], self._props(node["props"], names), [])
        next_depth = depth - 1 if depth > 0 else depth
        children = [self._layout(child, next_depth, names) for child in node["children"]]
        return (node["nid"], self._props(node["props"], names), children)
    def group_props(self, ids, names):
        out = []
        for nid in ids:
            node = self.node(nid)
            if node:
                out.append((node["nid"], self._props(node["props"], names)))
        return out
    def prop(self, nid, name):
        node = self.node(nid)
        if not node or name not in node["props"]:
            raise KeyError(name)
        return node["props"][name]


class App:
    def __init__(self, writer, backend=None):
        self.w = writer
        self.backend = backend
        self.line = 0
        self.initialized = False
        self.stopped = False
        self.menu = MenuModel()
        self.menu_hash = shash([])
        self.tooltip_hash = shash(["AI Gauge", ""])
        self.state = {
            "title": "AI Gauge",
            "category": "ApplicationStatus",
            "id": "ai-gauge",
            "status": "Passive",
            "icon": "ai-gauge-waiting",
            "tooltip_title": "AI Gauge",
            "tooltip_body": "",
        }
    def emit(self, payload):
        self.w.send(payload)
    def err(self, reason, message):
        self.emit({"event": "helper-error", "reason": reason, "message": message})
    def sni_props(self):
        return {
            "Category": self.state["category"],
            "Id": self.state["id"],
            "Title": self.state["title"],
            "Status": self.state["status"],
            "WindowId": 0,
            "IconName": self.state["icon"],
            "IconPixmap": [],
            "OverlayIconName": "",
            "OverlayIconPixmap": [],
            "AttentionIconName": "",
            "AttentionIconPixmap": [],
            "AttentionMovieName": "",
            "ToolTip": (
                self.state["icon"],
                [],
                self.state["tooltip_title"],
                self.state["tooltip_body"],
            ),
            "ItemIsMenu": True,
            "Menu": MENU_PATH,
            "IconThemePath": ICON_THEME_PATH,
        }
    def require_init(self):
        if not self.initialized:
            raise ValueError("init must be sent before other commands")
    def safe_emit(self, fn):
        try:
            fn()
        except Exception as exc:
            eprint(f"signal emission failed: {exc}")
            self.err("signal-emit-failed", str(exc))
    def process_line(self, raw_line, echo=False):
        self.line += 1
        if len(raw_line.encode("utf-8")) > MAX_LINE_BYTES:
            eprint(f"stdin line {self.line} exceeded 1 MB; dropped")
            return
        text = raw_line.rstrip("\n")
        if not text.strip():
            return
        try:
            cmd = json.loads(text)
        except json.JSONDecodeError as exc:
            eprint(f"invalid JSON on line {self.line}: {exc}")
            self.err("parse-error", f"invalid JSON on line {self.line}: {exc}")
            return
        if not isinstance(cmd, dict):
            self.err("parse-error", f"invalid JSON on line {self.line}: root must be an object")
            return
        if self.handle(cmd) and echo:
            self.emit({"event": "test-echo", "cmd": cmd})
    def handle(self, cmd):
        name = cmd.get("cmd")
        if name not in VALID_COMMANDS:
            self.err("unknown-command", f"unknown command: {name}")
            return False
        try:
            if name == "init":
                self.state["title"] = ensure_string(cmd.get("title"), "title")
                self.state["category"] = ensure_string(cmd.get("category"), "category")
                self.state["id"] = ensure_string(cmd.get("id"), "id")
                self.initialized = True
                if self.backend:
                    self.backend.register_after_init()
                    self.safe_emit(self.backend.emit_title_changed)
                return True

            if name == "set-icon":
                self.require_init()
                icon = ensure_string(cmd.get("name"), "name")
                if icon not in VALID_ICONS:
                    self.err("unknown-icon", f"unknown icon: {icon}")
                    return False
                if self.state["icon"] != icon:
                    self.state["icon"] = icon
                    if self.backend:
                        self.safe_emit(self.backend.emit_icon_changed)
                return True

            if name == "set-status":
                self.require_init()
                status = ensure_string(cmd.get("value"), "value")
                if status not in VALID_STATUSES:
                    self.err("invalid-status", f"invalid status: {status}")
                    return False
                if self.state["status"] != status:
                    self.state["status"] = status
                    if self.backend:
                        self.safe_emit(lambda: self.backend.emit_status_changed(status))
                return True

            if name == "set-tooltip":
                self.require_init()
                title = ensure_string(cmd.get("title"), "title")
                body = ensure_string(cmd.get("body"), "body")
                digest = shash([title, body])
                if digest != self.tooltip_hash:
                    self.tooltip_hash = digest
                    self.state["tooltip_title"] = title
                    self.state["tooltip_body"] = body
                    if self.backend:
                        self.safe_emit(self.backend.emit_tooltip_changed)
                return True

            if name == "set-menu":
                self.require_init()
                items = cmd.get("items")
                if not isinstance(items, list):
                    raise ValueError("items must be an array")
                digest = shash(items)
                if digest != self.menu_hash:
                    self.menu_hash = digest
                    updated, removed, changed = self.menu.set_items(items)
                    if self.backend:
                        self.safe_emit(lambda: self.backend.emit_menu_diff(updated, removed, changed))
                return True

            self.stopped = True
            if self.backend:
                self.backend.shutdown()
            return True
        except ValueError as exc:
            self.err("parse-error", str(exc))
            return False

class BackendBase:
    def __init__(self, app):
        self.app = app
        self.loop = None
        self.bus_name = ""
    def quit(self):
        if self.loop is not None:
            self.loop.quit()


class DBusPythonBackend(BackendBase):
    def __init__(self, app, mod):
        super().__init__(app)
        self.dbus = mod["dbus"]
        self.service = mod["service"]
        self.GLib = mod["GLib"]
        mod["mainloop"].DBusGMainLoop(set_as_default=True)
        self.bus = self.dbus.SessionBus()
        self.loop = self.GLib.MainLoop()
        self.claim = None
        self.sni = None
        self.menu = None
        self._objects()
    def _wrap(self, value):
        d = self.dbus
        if isinstance(value, bool):
            return d.Boolean(value)
        if isinstance(value, int):
            return d.Int32(value)
        if isinstance(value, str):
            if value == MENU_PATH:
                return d.ObjectPath(value)
            return d.String(value)
        if isinstance(value, tuple) and len(value) == 4:
            return d.Struct((d.String(value[0]), d.Array([], signature="(iiay)"), d.String(value[2]), d.String(value[3])))
        if isinstance(value, list):
            if all(isinstance(item, str) for item in value):
                return d.Array([d.String(item) for item in value], signature="s")
            return d.Array([self._wrap(item) for item in value], signature="v")
        if isinstance(value, dict):
            wrapped = {str(key): self._wrap(item) for key, item in value.items()}
            return d.Dictionary(wrapped, signature="sv")
        return value
    def _sni_get(self, iface, name):
        if iface != SNI_IFACE:
            raise self.dbus.exceptions.DBusException("org.freedesktop.DBus.Error.UnknownInterface", iface)
        props = self.app.sni_props()
        if name not in props:
            raise self.dbus.exceptions.DBusException("org.freedesktop.DBus.Error.UnknownProperty", name)
        return self._wrap(props[name])
    def _menu_get(self, iface, name):
        if iface != MENU_IFACE:
            raise self.dbus.exceptions.DBusException("org.freedesktop.DBus.Error.UnknownInterface", iface)
        props = {
            "Version": self.dbus.UInt32(self.app.menu.revision),
            "TextDirection": self.dbus.String("ltr"),
            "Status": self.dbus.String("normal"),
        }
        if name not in props:
            raise self.dbus.exceptions.DBusException("org.freedesktop.DBus.Error.UnknownProperty", name)
        return props[name]
    def _layout_struct(self, layout):
        nid, props, children = layout
        child_structs = [self._layout_struct(child) for child in children]
        return self.dbus.Struct((self.dbus.Int32(nid), self._wrap(props), self.dbus.Array(child_structs, signature="v")))
    def _menu_click(self, nid, event_id, timestamp):
        if event_id != "clicked":
            return True
        if not self.app.menu.clickable(nid):
            return False
        logical_id = self.app.menu.logical(nid)
        if not logical_id:
            return False
        self.app.emit({"event": "menu-click", "id": logical_id})
        self.menu.ItemActivationRequested(int(nid), self.dbus.UInt32(max(int(timestamp), 0)))
        return True
    def _about(self, nid):
        node = self.app.menu.node(nid)
        if node and node["lid"] and node["kind"] == "menu":
            self.app.emit({"event": "menu-about-to-show", "id": node["lid"]})
        return False
    def _watcher(self, name):
        proxy = self.bus.get_object(name, WATCHER_PATH)
        return self.dbus.Interface(proxy, name)
    def _claim_name(self):
        for suffix in range(1, 11):
            if suffix == 1:
                candidate = f"org.kde.StatusNotifierItem-{os.getpid()}-1"
            else:
                candidate = f"org.kde.StatusNotifierItem-{os.getpid()}-1-{suffix}"
            try:
                self.claim = self.service.BusName(candidate, bus=self.bus, do_not_queue=True, allow_replacement=False, replace_existing=False)
                return candidate
            except Exception:
                pass
        raise RuntimeError("failed to claim unique SNI bus name")
    def _objects(self):
        dbus = self.dbus
        service = self.service
        app = self.app
        backend = self
        class SNI(service.Object):
            def __init__(self):
                super().__init__(backend.bus, SNI_PATH)
            @service.method(INTRO_IFACE, in_signature="", out_signature="s")
            def Introspect(self):
                return SNI_XML
            @service.method(PROPS_IFACE, in_signature="ss", out_signature="v")
            def Get(self, iface, name):
                return backend._sni_get(iface, name)
            @service.method(PROPS_IFACE, in_signature="s", out_signature="a{sv}")
            def GetAll(self, iface):
                if iface != SNI_IFACE:
                    return {}
                return {key: backend._wrap(value) for key, value in app.sni_props().items()}
            @service.method(PROPS_IFACE, in_signature="ssv", out_signature="")
            def Set(self, iface, name, value):
                raise dbus.exceptions.DBusException("org.freedesktop.DBus.Error.PropertyReadOnly", "properties are read-only")
            @service.signal(PROPS_IFACE, signature="sa{sv}as")
            def PropertiesChanged(self, iface, changed, invalidated):
                return None
            @service.method(SNI_IFACE, in_signature="ii", out_signature="")
            def Activate(self, x, y):
                app.emit({"event": "activate", "x": int(x), "y": int(y)})
            @service.method(SNI_IFACE, in_signature="ii", out_signature="")
            def SecondaryActivate(self, x, y):
                app.emit({"event": "secondary-activate", "x": int(x), "y": int(y)})
            @service.method(SNI_IFACE, in_signature="ii", out_signature="")
            def ContextMenu(self, x, y):
                app.emit({"event": "context-menu", "x": int(x), "y": int(y)})
            @service.method(SNI_IFACE, in_signature="is", out_signature="")
            def Scroll(self, delta, orientation):
                return None
            @service.signal(SNI_IFACE, signature="")
            def NewTitle(self):
                return None
            @service.signal(SNI_IFACE, signature="")
            def NewIcon(self):
                return None
            @service.signal(SNI_IFACE, signature="")
            def NewAttentionIcon(self):
                return None
            @service.signal(SNI_IFACE, signature="")
            def NewOverlayIcon(self):
                return None
            @service.signal(SNI_IFACE, signature="")
            def NewToolTip(self):
                return None
            @service.signal(SNI_IFACE, signature="s")
            def NewStatus(self, status):
                return None
        class Menu(service.Object):
            def __init__(self):
                super().__init__(backend.bus, MENU_PATH)
            @service.method(INTRO_IFACE, in_signature="", out_signature="s")
            def Introspect(self):
                return MENU_XML
            @service.method(PROPS_IFACE, in_signature="ss", out_signature="v")
            def Get(self, iface, name):
                return backend._menu_get(iface, name)
            @service.method(PROPS_IFACE, in_signature="s", out_signature="a{sv}")
            def GetAll(self, iface):
                if iface != MENU_IFACE:
                    return {}
                return {
                    "Version": dbus.UInt32(app.menu.revision),
                    "TextDirection": dbus.String("ltr"),
                    "Status": dbus.String("normal"),
                }
            @service.method(PROPS_IFACE, in_signature="ssv", out_signature="")
            def Set(self, iface, name, value):
                raise dbus.exceptions.DBusException("org.freedesktop.DBus.Error.PropertyReadOnly", "properties are read-only")
            @service.signal(PROPS_IFACE, signature="sa{sv}as")
            def PropertiesChanged(self, iface, changed, invalidated):
                return None
            @service.method(MENU_IFACE, in_signature="iias", out_signature="u(ia{sv}av)")
            def GetLayout(self, parent_id, depth, names):
                layout = app.menu.layout(int(parent_id), int(depth), names)
                return dbus.UInt32(app.menu.revision), backend._layout_struct(layout)
            @service.method(MENU_IFACE, in_signature="aias", out_signature="a(ia{sv})")
            def GetGroupProperties(self, ids, names):
                rows = []
                for nid, props in app.menu.group_props(ids, names):
                    rows.append(dbus.Struct((dbus.Int32(nid), backend._wrap(props))))
                return dbus.Array(rows, signature="(ia{sv})")
            @service.method(MENU_IFACE, in_signature="is", out_signature="v")
            def GetProperty(self, nid, name):
                return backend._wrap(app.menu.prop(int(nid), name))
            @service.method(MENU_IFACE, in_signature="isvu", out_signature="")
            def Event(self, nid, event_id, data, timestamp):
                backend._menu_click(int(nid), event_id, int(timestamp))
            @service.method(MENU_IFACE, in_signature="a(isvu)", out_signature="ai")
            def EventGroup(self, events):
                errors = []
                for nid, event_id, data, timestamp in events:
                    if not backend._menu_click(int(nid), event_id, int(timestamp)):
                        errors.append(int(nid))
                return errors
            @service.method(MENU_IFACE, in_signature="i", out_signature="b")
            def AboutToShow(self, nid):
                return backend._about(int(nid))
            @service.method(MENU_IFACE, in_signature="ai", out_signature="aiai")
            def AboutToShowGroup(self, ids):
                updates = []
                errors = []
                for nid in ids:
                    if backend._about(int(nid)):
                        updates.append(int(nid))
                    elif app.menu.node(int(nid)) is None:
                        errors.append(int(nid))
                return updates, errors
            @service.signal(MENU_IFACE, signature="a(ia{sv})a(ias)")
            def ItemsPropertiesUpdated(self, updated, removed):
                return None
            @service.signal(MENU_IFACE, signature="ui")
            def LayoutUpdated(self, revision, parent):
                return None
            @service.signal(MENU_IFACE, signature="iu")
            def ItemActivationRequested(self, nid, timestamp):
                return None
        self.sni = SNI()
        self.menu = Menu()
    def register_after_init(self):
        if self.bus_name:
            return
        self.bus_name = self._claim_name()
        for watcher in WATCHERS:
            try:
                self._watcher(watcher).RegisterStatusNotifierItem(self.bus_name, timeout=5.0)
                return
            except Exception:
                pass
        self.app.emit({"event": "watcher-unavailable", "reason": "org.kde.StatusNotifierWatcher was not provided"})
        raise SystemExit(2)
    def shutdown(self):
        for watcher in WATCHERS:
            try:
                proxy = self._watcher(watcher)
                if hasattr(proxy, "UnregisterStatusNotifierItem"):
                    proxy.UnregisterStatusNotifierItem(self.bus_name, timeout=1.0)
            except Exception:
                pass
        try:
            if self.claim:
                self.claim.release()
        except Exception:
            pass
        self.quit()
    def emit_title_changed(self):
        self.sni.PropertiesChanged(SNI_IFACE, {"Title": self._wrap(self.app.state["title"])}, [])
        self.sni.NewTitle()
    def emit_icon_changed(self):
        props = {
            "IconName": self._wrap(self.app.state["icon"]),
            "IconThemePath": self._wrap(ICON_THEME_PATH),
        }
        self.sni.PropertiesChanged(SNI_IFACE, props, [])
        self.sni.NewIcon()
    def emit_status_changed(self, status):
        self.sni.PropertiesChanged(SNI_IFACE, {"Status": self._wrap(status)}, [])
        self.sni.NewStatus(status)
    def emit_tooltip_changed(self):
        tooltip = self._wrap(self.app.sni_props()["ToolTip"])
        self.sni.PropertiesChanged(SNI_IFACE, {"ToolTip": tooltip}, [])
        self.sni.NewToolTip()
    def emit_menu_diff(self, updated, removed, changed):
        if updated or removed:
            wrapped_updated = []
            wrapped_removed = []
            for nid, props in updated:
                wrapped_updated.append(self.dbus.Struct((self.dbus.Int32(nid), self._wrap(props))))
            for nid, names in removed:
                values = [self.dbus.String(name) for name in names]
                wrapped_removed.append(self.dbus.Struct((self.dbus.Int32(nid), self.dbus.Array(values, signature="s"))))
            self.menu.ItemsPropertiesUpdated(wrapped_updated, wrapped_removed)
        if changed:
            self.menu.LayoutUpdated(self.dbus.UInt32(self.app.menu.revision), self.dbus.Int32(0))
            self.menu.PropertiesChanged(MENU_IFACE, {"Version": self.dbus.UInt32(self.app.menu.revision)}, [])
    def _stdin(self, source, cond):
        if cond & self.GLib.IO_HUP:
            self.quit()
            return False
        line = sys.stdin.readline()
        if line == "":
            self.quit()
            return False
        self.app.process_line(line, False)
        return True
    def run(self):
        try:
            sys.stdin.reconfigure(line_buffering=True)
        except Exception:
            pass
        self.GLib.io_add_watch(sys.stdin.fileno(), self.GLib.IO_IN | self.GLib.IO_HUP, self._stdin)
        self.loop.run()
        return 0


def detect_backend():
    try:
        import dbus
        import dbus.mainloop.glib
        import dbus.service
        from gi.repository import GLib

        return "dbus-python", {
            "dbus": dbus,
            "mainloop": dbus.mainloop.glib,
            "service": dbus.service,
            "GLib": GLib,
        }
    except ImportError:
        pass

    try:
        import dasbus  # noqa: F401
        from gi.repository import GLib  # noqa: F401
        return "dasbus", {}
    except ImportError:
        return None, {}


def run_test_mode():
    app = App(Writer())
    def stop(signum, frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    for line in sys.stdin:
        app.process_line(line, True)
        if app.stopped:
            return 0
    return 0


def run_live_mode():
    writer = Writer()
    kind, mod = detect_backend()
    if not kind:
        writer.send({"event": "helper-error", "reason": "dbus-import-failed", "message": "failed to import dbus-python and dasbus backends"})
        return 3
    if kind == "dasbus":
        writer.send({"event": "helper-error", "reason": "dbus-import-failed", "message": "dbus-python unavailable; dasbus runtime backend deferred to v1.1"})
        return 3
    app = App(writer)
    backend = DBusPythonBackend(app, mod)
    app.backend = backend
    def stop(signum, frame):
        app.stopped = True
        backend.shutdown()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        return backend.run()
    except SystemExit as exc:
        if isinstance(exc.code, int):
            return exc.code
        return 0
    except KeyboardInterrupt:
        return 0


def main():
    if TEST_MODE:
        return run_test_mode()
    return run_live_mode()

if __name__ == "__main__":
    sys.exit(main())
