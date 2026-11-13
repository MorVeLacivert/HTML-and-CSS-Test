"""
Pizza Tower 2 - prototype (pygame, browser-ready via pygbag).
All art is placeholder shapes so you can swap in sprites later.

Run locally :  pip install pygame && python main.py
Run in browser: pip install pygbag && pygbag pizza_tower2   (then open http://localhost:8000)
"""
import asyncio
import json
import math
import random

import pygame

# ----------------------------------------------------------------- constants
W, H = 960, 540
FPS = 60
GRAV = 0.6
SAVE_FILE = "highscores.json"

# difficulty -> seconds until pizzaface appears, pizzaface speed (px/frame)
DIFFICULTY = {
    "Easy":   {"time": 40, "pf_speed": 3.4},
    "Medium": {"time": 28, "pf_speed": 4.1},
    "Hard":   {"time": 20, "pf_speed": 4.7},
}

TOPPINGS = ["Mushroom", "Cheese", "Tomato", "Sausage", "Pineapple"]
TOPPING_COLORS = [(190, 160, 120), (250, 210, 70), (220, 50, 40), (160, 70, 50), (255, 230, 90)]
POTIONS = {"speed": (255, 200, 40), "ghost": (235, 235, 255), "fly": (80, 200, 255)}
POTION_SECONDS = 6

# rank -> (min score, pose label, music label, colour)
RANKS = [
    ("S", 1100, "Victory dance", "rank_s.ogg", (255, 215, 0)),
    ("A", 850,  "Happy jump",    "rank_a.ogg", (120, 230, 120)),
    ("B", 600,  "Thumbs up",     "rank_b.ogg", (100, 180, 255)),
    ("C", 350,  "Shrug",         "rank_c.ogg", (230, 160, 90)),
    ("D", 0,    "Exhausted",     "rank_d.ogg", (200, 90, 90)),
]


def rank_for(score):
    for r in RANKS:
        if score >= r[1]:
            return r
    return RANKS[-1]


# ----------------------------------------------------------------- entities
class Player:
    def __init__(self, x, y):
        self.rect = pygame.Rect(x, y, 34, 56)
        self.vx = 0.0
        self.vy = 0.0
        self.on_ground = False
        self.facing = 1
        self.attack_t = 0      # frames left of the bash attack
        self.stun_t = 0        # frames left of knockback stun
        self.potion_t = {"speed": 0, "ghost": 0, "fly": 0}
        self.inv = {"speed": 0, "ghost": 0, "fly": 0}

    def attack_box(self):
        if self.attack_t <= 0:
            return None
        box = self.rect.inflate(30, 6)
        box.x += 18 * self.facing
        return box


class Enemy:
    def __init__(self, x, y, minx, maxx, hp=1, size=(36, 36), speed=1.6):
        self.rect = pygame.Rect(x, y, *size)
        self.minx, self.maxx = minx, maxx
        self.dir = 1
        self.hp = hp
        self.max_hp = hp
        self.speed = speed
        self.hurt_t = 0

    def update(self):
        self.rect.x += int(self.dir * self.speed)
        if self.rect.left < self.minx or self.rect.right > self.maxx:
            self.dir *= -1
        if self.hurt_t > 0:
            self.hurt_t -= 1


# ----------------------------------------------------------------- level data
def build_level(kind):
    """Return a dict describing one level. Everything is plain data -> easy to edit."""
    if kind == "Level 1":
        width = 3200
        solids = [pygame.Rect(0, 480, width, 60)]
        for x, y, w in [(300, 400, 160), (520, 330, 160), (760, 400, 160), (1000, 340, 200),
                        (1300, 420, 140), (1500, 350, 160), (1750, 280, 200), (2000, 400, 160),
                        (2450, 380, 180), (2700, 300, 160)]:
            solids.append(pygame.Rect(x, y, w, 20))
        return {
            "name": kind, "width": width, "solids": solids,
            "spawn": (110, 420), "door": pygame.Rect(40, 380, 60, 100),
            "gate": pygame.Rect(2300, 260, 30, 220),
            "key": pygame.Rect(1830, 240, 24, 24),
            "pillar": pygame.Rect(3040, 380, 60, 100), "boss": None,
            "toppings": [(380, 360), (590, 290), (1090, 300), (1830, 240 - 40), (2540, 340)],
            "minis": [(x, 440) for x in range(450, 2200, 190)] + [(2800, 260), (2850, 260)],
            "potions": [("speed", 650, 440), ("ghost", 1380, 380), ("fly", 2100, 360)],
            "enemies": [Enemy(600, 444, 520, 900, ), Enemy(1100, 444, 1000, 1300),
                        Enemy(1550, 314, 1500, 1660), Enemy(1950, 444, 1700, 2250),
                        Enemy(2550, 444, 2340, 2900), Enemy(2800, 444, 2400, 3000)],
        }
    # Boss arena
    width = 1500
    solids = [pygame.Rect(0, 480, width, 60), pygame.Rect(250, 380, 180, 20),
              pygame.Rect(1050, 380, 180, 20), pygame.Rect(650, 300, 200, 20)]
    return {
        "name": kind, "width": width, "solids": solids,
        "spawn": (110, 420), "door": pygame.Rect(40, 380, 60, 100),
        "gate": None, "key": None, "pillar": None,
        "boss": Enemy(1000, 380, 500, 1450, hp=5, size=(100, 100), speed=2.2),
        "toppings": [(340, 340), (750, 260), (1140, 340), (900, 440), (500, 440)],
        "minis": [(x, 440) for x in range(300, 1300, 120)],
        "potions": [("speed", 600, 440), ("ghost", 760, 260), ("fly", 1200, 440)],
        "enemies": [],
    }


# ----------------------------------------------------------------- game
class Game:
    def __init__(self):
        pygame.init()
        self.screen = pygame.display.set_mode((W, H))
        pygame.display.set_caption("Pizza Tower 2")
        self.clock = pygame.time.Clock()
        self.state = "menu"
        self.sel = 0
        self.difficulty = "Medium"
        self.level_name = "Level 1"
        self.keys = {"Left": pygame.K_a, "Right": pygame.K_d,
                     "Jump": pygame.K_SPACE, "Attack": pygame.K_j}
        self.rebinding = None
        self.opt = {"music": 0.7, "sfx": 0.8, "contrast": False, "text": 1.0}
        self.scores = self.load_scores()
        self.result = None
        self.new_best = False
        self.fonts = {}

    # ---------------------------------------------------------- persistence
    def load_scores(self):
        try:
            with open(SAVE_FILE) as f:
                return json.load(f)
        except Exception:
            return {}

    def save_scores(self):
        try:
            with open(SAVE_FILE, "w") as f:
                json.dump(self.scores, f)
        except Exception:
            pass  # read-only filesystems (browser) simply keep scores in memory

    # ---------------------------------------------------------- helpers
    def font(self, size):
        size = int(size * self.opt["text"])
        if size not in self.fonts:
            self.fonts[size] = pygame.font.Font(None, size)
        return self.fonts[size]

    def text(self, s, size, x, y, color=None, center=True):
        color = color or ((255, 255, 255) if self.opt["contrast"] else (255, 245, 220))
        img = self.font(size).render(s, True, color)
        r = img.get_rect(center=(x, y)) if center else img.get_rect(topleft=(x, y))
        self.screen.blit(img, r)

    def key_name(self, k):
        return pygame.key.name(k).upper()

    def start_level(self):
        lv = build_level(self.level_name)
        self.lv = lv
        self.p = Player(*lv["spawn"])
        self.score = 0
        self.has_key = False
        self.toppings = [False] * len(lv["toppings"])
        self.minis = list(lv["minis"])
        self.potion_items = list(lv["potions"])
        self.enemies = lv["enemies"]
        self.boss = lv["boss"]
        self.pillar_alive = lv["pillar"] is not None
        self.escape = False
        self.escape_frames = 0
        self.pf = None            # pizzaface rect (float pos kept separately)
        self.pf_pos = [0.0, 0.0]
        self.cam_x = 0
        self.msg = "Collect every topping, bash the enemies, break the pillar!"
        self.msg_t = 240
        self.play_frames = 0
        self.state = "play"

    def finish(self, won):
        mins = self.p
        bonus = 0
        if won:
            bonus = max(0, (self.escape_frames // FPS)) * 10
            self.score += bonus
        key = f"{self.level_name}|{self.difficulty}"
        self.new_best = won and self.score > self.scores.get(key, 0)
        if self.new_best:
            self.scores[key] = self.score
            self.save_scores()
        self.result = {"won": won, "score": self.score, "bonus": bonus,
                       "rank": rank_for(self.score) if won else None,
                       "best": self.scores.get(key, 0)}
        self.state = "result"
        self.sel = 0

    def trigger_escape(self):
        self.escape = True
        self.escape_frames = DIFFICULTY[self.difficulty]["time"] * FPS
        self.msg = "ESCAPE! Run back to the door before Pizzaface arrives!"
        self.msg_t = 240

    # ---------------------------------------------------------- input
    def menu_nav(self, e, n):
        if e.key in (pygame.K_UP, pygame.K_w):
            self.sel = (self.sel - 1) % n
        elif e.key in (pygame.K_DOWN, pygame.K_s):
            self.sel = (self.sel + 1) % n

    def handle(self, e):
        if e.type != pygame.KEYDOWN:
            return
        st = self.state
        if st == "menu":
            items = ["Start", "How to Play", "Options", "Quit"]
            self.menu_nav(e, len(items))
            if e.key == pygame.K_RETURN:
                c = items[self.sel]
                if c == "Start":
                    self.state, self.sel = "difficulty", 1
                elif c == "How to Play":
                    self.state = "howto"
                elif c == "Options":
                    self.state, self.sel = "options", 0
                else:
                    pygame.event.post(pygame.event.Event(pygame.QUIT))
        elif st == "difficulty":
            items = ["Easy", "Medium", "Hard", "Back"]
            self.menu_nav(e, len(items))
            if e.key == pygame.K_ESCAPE:
                self.state, self.sel = "menu", 0
            elif e.key == pygame.K_RETURN:
                if items[self.sel] == "Back":
                    self.state, self.sel = "menu", 0
                else:
                    self.difficulty = items[self.sel]
                    self.state, self.sel = "levels", 0
        elif st == "levels":
            items = ["Level 1", "Boss Fight", "Back"]
            self.menu_nav(e, len(items))
            if e.key == pygame.K_ESCAPE:
                self.state, self.sel = "difficulty", 1
            elif e.key == pygame.K_RETURN:
                if items[self.sel] == "Back":
                    self.state, self.sel = "difficulty", 1
                else:
                    self.level_name = items[self.sel]
                    self.start_level()
        elif st == "howto":
            if e.key in (pygame.K_ESCAPE, pygame.K_RETURN):
                self.state, self.sel = "menu", 1
        elif st == "options":
            self.handle_options(e)
        elif st == "play":
            if e.key == pygame.K_ESCAPE:
                self.state, self.sel = "menu", 0
            elif e.key == self.keys["Attack"] and self.p.attack_t <= 0 and self.p.stun_t <= 0:
                self.p.attack_t = 16
            elif e.key in (pygame.K_1, pygame.K_2, pygame.K_3):
                name = ["speed", "ghost", "fly"][e.key - pygame.K_1]
                if self.p.inv[name] > 0:
                    self.p.inv[name] -= 1
                    self.p.potion_t[name] = POTION_SECONDS * FPS
        elif st == "result":
            self.menu_nav(e, 2)
            if e.key == pygame.K_RETURN:
                if self.sel == 0:
                    self.start_level()
                else:
                    self.state, self.sel = "menu", 0

    def option_items(self):
        return (["Music Volume", "SFX Volume", "High Contrast", "Text Size"]
                + [f"Key: {k}" for k in self.keys] + ["Back"])

    def handle_options(self, e):
        if self.rebinding:
            if e.key != pygame.K_ESCAPE:
                self.keys[self.rebinding] = e.key
            self.rebinding = None
            return
        items = self.option_items()
        self.menu_nav(e, len(items))
        c = items[self.sel]
        step = 0.1 if e.key == pygame.K_RIGHT else -0.1 if e.key == pygame.K_LEFT else 0
        if e.key == pygame.K_ESCAPE:
            self.state, self.sel = "menu", 2
        elif c == "Music Volume" and step:
            self.opt["music"] = min(1, max(0, self.opt["music"] + step))
            pygame.mixer.music.set_volume(self.opt["music"]) if pygame.mixer.get_init() else None
        elif c == "SFX Volume" and step:
            self.opt["sfx"] = min(1, max(0, self.opt["sfx"] + step))
        elif c == "Text Size" and step:
            self.opt["text"] = round(min(1.5, max(0.8, self.opt["text"] + step)), 1)
        elif e.key == pygame.K_RETURN:
            if c == "High Contrast":
                self.opt["contrast"] = not self.opt["contrast"]
            elif c.startswith("Key: "):
                self.rebinding = c[5:]
            elif c == "Back":
                self.state, self.sel = "menu", 2

    # ---------------------------------------------------------- physics
    def solids(self):
        s = list(self.lv["solids"])
        gate = self.lv["gate"]
        if gate and not self.has_key and self.p.potion_t["ghost"] <= 0:
            s.append(gate)
        return s

    def move_player(self):
        p = self.p
        solids = self.solids()
        dx = int(math.copysign(math.ceil(abs(p.vx)), p.vx)) if p.vx else 0
        p.rect.x += dx
        for s in solids:
            if p.rect.colliderect(s):
                if dx > 0:
                    p.rect.right = s.left
                elif dx < 0:
                    p.rect.left = s.right
        dy = int(math.copysign(math.ceil(abs(p.vy)), p.vy)) if p.vy else 0
        p.rect.y += dy
        p.on_ground = False
        for s in solids:
            if p.rect.colliderect(s):
                if dy > 0:
                    p.rect.bottom = s.top
                    p.on_ground = True
                elif dy < 0:
                    p.rect.top = s.bottom
                p.vy = 0
        p.rect.x = max(0, min(self.lv["width"] - p.rect.w, p.rect.x))

    def hurt_player(self, from_x):
        p = self.p
        if p.stun_t > 0 or p.potion_t["ghost"] > 0:
            return
        self.score = max(0, self.score - 50)
        p.stun_t = 24
        p.attack_t = 0
        p.vx = 8 if p.rect.centerx > from_x else -8
        p.vy = -7

    # ---------------------------------------------------------- update
    def update(self):
        if self.state != "play":
            return
        p, lv = self.p, self.lv
        keys = pygame.key.get_pressed()
        self.play_frames += 1

        # potions tick down
        for n in p.potion_t:
            if p.potion_t[n] > 0:
                p.potion_t[n] -= 1

        speed = 5.0 * (1.6 if p.potion_t["speed"] > 0 else 1.0)
        flying = p.potion_t["fly"] > 0

        if p.stun_t > 0:
            p.stun_t -= 1
        elif p.attack_t > 0:
            p.attack_t -= 1
            p.vx = p.facing * 9
        else:
            p.vx = 0
            if keys[self.keys["Left"]]:
                p.vx, p.facing = -speed, -1
            if keys[self.keys["Right"]]:
                p.vx, p.facing = speed, 1

        if flying:
            p.vy = -4.5 if keys[self.keys["Jump"]] else 1.5
        else:
            p.vy = min(p.vy + GRAV, 14)
            if keys[self.keys["Jump"]] and p.on_ground and p.stun_t <= 0:
                p.vy = -12.5
        self.move_player()

        box = p.attack_box()
        targets = list(self.enemies) + ([self.boss] if self.boss else [])

        # enemies
        for en in list(targets):
            en.update()
            hit_by_attack = box and box.colliderect(en.rect)
            stomp = (p.vy > 0 and p.rect.bottom - en.rect.top < 16 and p.rect.colliderect(en.rect))
            if (hit_by_attack or stomp) and en.hurt_t <= 0:
                en.hp -= 1
                en.hurt_t = 30
                if stomp:
                    p.vy = -9
                if en.hp <= 0:
                    self.score += 50 if en is not self.boss else 300
                    if en is self.boss:
                        self.boss = None
                        self.trigger_escape()
                    else:
                        self.enemies.remove(en)
            elif p.rect.colliderect(en.rect) and en.hurt_t <= 0:
                self.hurt_player(en.rect.centerx)

        # pickups
        for i, (x, y) in enumerate(lv["toppings"]):
            if not self.toppings[i] and p.rect.colliderect(pygame.Rect(x - 14, y - 14, 28, 28)):
                self.toppings[i] = True
                self.score += 100
        for m in list(self.minis):
            if p.rect.colliderect(pygame.Rect(m[0] - 9, m[1] - 9, 18, 18)):
                self.minis.remove(m)
                self.score += 10
        for it in list(self.potion_items):
            if p.rect.colliderect(pygame.Rect(it[1] - 14, it[2] - 14, 28, 28)):
                self.potion_items.remove(it)
                p.inv[it[0]] += 1
        key = lv["key"]
        if key and not self.has_key and p.rect.colliderect(key):
            self.has_key = True
            self.msg, self.msg_t = "Key found! The gate is open.", 150

        # pillar
        pil = lv["pillar"]
        if self.pillar_alive and pil and (box and box.colliderect(pil) or
                                          (p.attack_t > 0 and p.rect.colliderect(pil))):
            self.pillar_alive = False
            self.score += 200
            self.trigger_escape()

        # escape phase
        if self.escape:
            if self.escape_frames > 0:
                self.escape_frames -= 1
                if self.escape_frames == 0:
                    self.pf_pos = [min(lv["width"] - 100, p.rect.x + 700), p.rect.y - 250]
                    self.pf = pygame.Rect(0, 0, 120, 120)
                    self.msg, self.msg_t = "PIZZAFACE HAS ARRIVED!", 150
            if self.pf:
                dx = p.rect.centerx - self.pf_pos[0]
                dy = p.rect.centery - self.pf_pos[1]
                d = math.hypot(dx, dy) or 1
                sp = DIFFICULTY[self.difficulty]["pf_speed"]
                self.pf_pos[0] += dx / d * sp
                self.pf_pos[1] += dy / d * sp
                self.pf.center = (int(self.pf_pos[0]), int(self.pf_pos[1]))
                if self.pf.inflate(-30, -30).colliderect(p.rect):
                    self.finish(False)
                    return
            if p.rect.colliderect(lv["door"]):
                self.finish(True)
                return

        self.cam_x = max(0, min(lv["width"] - W, p.rect.centerx - W // 2))
        if self.msg_t > 0:
            self.msg_t -= 1

    # ---------------------------------------------------------- drawing
    def draw(self):
        hc = self.opt["contrast"]
        self.screen.fill((0, 0, 0) if hc else (60, 40, 70))
        getattr(self, "draw_" + self.state)()

    def draw_menu_list(self, items, y0=250, gap=55):
        for i, it in enumerate(items):
            on = i == self.sel
            col = (255, 220, 60) if on else (230, 230, 230)
            self.text(("> " if on else "") + it + (" <" if on else ""), 48, W // 2, y0 + i * gap, col)

    def draw_menu(self):
        self.text("PIZZA TOWER 2", 110, W // 2, 110, (255, 190, 50))
        pygame.draw.circle(self.screen, (240, 180, 60), (W // 2, 190), 28)
        self.draw_menu_list(["Start", "How to Play", "Options", "Quit"], 260)
        self.text("Up/Down + Enter", 28, W // 2, H - 30, (180, 180, 180))

    def draw_difficulty(self):
        self.text("Choose Difficulty", 72, W // 2, 90)
        self.draw_menu_list(["Easy", "Medium", "Hard", "Back"], 200)
        d = DIFFICULTY.get(["Easy", "Medium", "Hard", "Back"][self.sel])
        if d:
            self.text(f"Pizzaface arrives after {d['time']}s", 30, W // 2, 440, (200, 200, 200))

    def draw_levels(self):
        self.text("Choose a Level or Boss Fight", 64, W // 2, 90)
        self.draw_menu_list(["Level 1", "Boss Fight", "Back"], 220)
        for i, n in enumerate(["Level 1", "Boss Fight"]):
            best = self.scores.get(f"{n}|{self.difficulty}", 0)
            self.text(f"High score ({self.difficulty}): {best}", 26, W // 2 + 330, 220 + i * 55,
                      (190, 190, 190))

    def draw_howto(self):
        self.text("How to Play", 72, W // 2, 60)
        k = self.key_name
        lines = [
            f"{k(self.keys['Left'])} / {k(self.keys['Right'])} : move left / right",
            f"{k(self.keys['Jump'])} : jump (hold to rise while the FLY potion is active)",
            f"{k(self.keys['Attack'])} : bash attack (breaks enemies and the pillar)",
            "1 / 2 / 3 : drink Speed / Ghost / Fly potion",
            "",
            "GOAL: collect toppings, defeat enemies, break the pillar,",
            "then run back to the starting door before Pizzaface catches you!",
            "",
            "TIPS: Keys open gates. Ghost potion passes through enemies and gates.",
            "Enemy hits cost 50 points. Higher score = better rank (D to S).",
        ]
        for i, l in enumerate(lines):
            self.text(l, 30, W // 2, 140 + i * 36)
        self.text("Esc / Enter: back", 26, W // 2, H - 25, (180, 180, 180))

    def draw_options(self):
        self.text("Options", 72, 480, 50)
        items = self.option_items()
        for i, it in enumerate(items):
            y = 120 + i * 42
            on = i == self.sel
            col = (255, 220, 60) if on else (230, 230, 230)
            self.text(it, 34, 250, y, col, center=False)
            val = ""
            if it == "Music Volume":
                val = "|" * int(self.opt["music"] * 10) + "." * (10 - int(self.opt["music"] * 10))
            elif it == "SFX Volume":
                val = "|" * int(self.opt["sfx"] * 10) + "." * (10 - int(self.opt["sfx"] * 10))
            elif it == "High Contrast":
                val = "ON" if self.opt["contrast"] else "OFF"
            elif it == "Text Size":
                val = f"{self.opt['text']:.1f}x"
            elif it.startswith("Key: "):
                val = "press a key..." if self.rebinding == it[5:] else self.key_name(self.keys[it[5:]])
            self.text(val, 34, 560, y, col, center=False)
        self.text("Left/Right adjust, Enter toggle/rebind, Esc back", 24, W // 2, H - 20, (180, 180, 180))

    def draw_world_rect(self, r, color, outline=None):
        rr = r.move(-self.cam_x, 0)
        pygame.draw.rect(self.screen, color, rr)
        if outline or self.opt["contrast"]:
            pygame.draw.rect(self.screen, outline or (255, 255, 255), rr, 3)

    def draw_play(self):
        lv, p, cx = self.lv, self.p, self.cam_x
        hc = self.opt["contrast"]
        # parallax background tiles
        for i in range(0, lv["width"], 240):
            x = i - cx * 0.5
            pygame.draw.rect(self.screen, (0, 0, 0) if hc else (75, 55, 85), (x, 120, 120, 360), 0)
        # solids
        for s in lv["solids"]:
            self.draw_world_rect(s, (120, 80, 50) if not hc else (30, 30, 30))
        if lv["gate"] and not self.has_key:
            self.draw_world_rect(lv["gate"], (150, 150, 170), (255, 255, 255))
        self.draw_world_rect(lv["door"], (90, 200, 120), (255, 255, 255))
        self.text("EXIT" if self.escape else "DOOR", 22, lv["door"].centerx - cx, lv["door"].y - 12)
        if self.pillar_alive and lv["pillar"]:
            self.draw_world_rect(lv["pillar"], (170, 170, 190), (40, 40, 60))
            self.text("JOHN", 22, lv["pillar"].centerx - cx, lv["pillar"].centery)
        # items
        if lv["key"] and not self.has_key:
            self.draw_world_rect(lv["key"], (255, 215, 0), (90, 70, 0))
        for i, (x, y) in enumerate(lv["toppings"]):
            if not self.toppings[i]:
                pygame.draw.circle(self.screen, TOPPING_COLORS[i], (x - cx, y), 14)
                pygame.draw.circle(self.screen, (255, 255, 255), (x - cx, y), 14, 2)
        for m in self.minis:
            pygame.draw.circle(self.screen, (255, 140, 60), (m[0] - cx, m[1]), 8)
        for n, x, y in self.potion_items:
            pygame.draw.rect(self.screen, POTIONS[n], (x - cx - 9, y - 14, 18, 28), border_radius=6)
        # enemies
        for en in self.enemies + ([self.boss] if self.boss else []):
            col = (200, 50, 50) if en.hurt_t % 6 < 3 else (255, 255, 255)
            self.draw_world_rect(en.rect, col, (60, 0, 0))
            eye_y = en.rect.y + en.rect.h // 3
            for ox in (0.3, 0.7):
                pygame.draw.circle(self.screen, (255, 255, 255),
                                   (int(en.rect.x + en.rect.w * ox - cx), eye_y), max(4, en.rect.w // 9))
            if en.max_hp > 1:
                bw = en.rect.w
                pygame.draw.rect(self.screen, (80, 0, 0), (en.rect.x - cx, en.rect.y - 14, bw, 8))
                pygame.draw.rect(self.screen, (60, 220, 60),
                                 (en.rect.x - cx, en.rect.y - 14, bw * en.hp / en.max_hp, 8))
        # player
        pr = p.rect.move(-cx, 0)
        body = (255, 255, 255) if p.potion_t["ghost"] <= 0 else (200, 200, 255)
        pygame.draw.rect(self.screen, (60, 120, 220), pr)
        pygame.draw.rect(self.screen, body, (pr.x - 2, pr.y - 14, pr.w + 4, 16), border_radius=4)  # chef hat
        pygame.draw.circle(self.screen, (255, 255, 255), (pr.centerx + 8 * p.facing, pr.y + 18), 5)
        if p.potion_t["fly"] > 0:
            pygame.draw.polygon(self.screen, (80, 200, 255), [(pr.x, pr.centery), (pr.x - 24, pr.y), (pr.x - 24, pr.bottom)])
        box = p.attack_box()
        if box:
            pygame.draw.rect(self.screen, (255, 255, 120), box.move(-cx, 0), 3)
        # pizzaface
        if self.pf:
            c = (self.pf.centerx - cx, self.pf.centery)
            pygame.draw.circle(self.screen, (240, 190, 70), c, 60)
            pygame.draw.circle(self.screen, (200, 40, 40), (c[0] - 25, c[1] - 20), 12)
            pygame.draw.circle(self.screen, (200, 40, 40), (c[0] + 20, c[1] + 10), 12)
            pygame.draw.circle(self.screen, (255, 255, 255), (c[0] - 20, c[1] - 5), 10)
            pygame.draw.circle(self.screen, (255, 255, 255), (c[0] + 20, c[1] - 5), 10)
        self.draw_hud()

    def draw_hud(self):
        pygame.draw.rect(self.screen, (0, 0, 0), (0, 0, W, 44))
        self.text(f"SCORE {self.score}", 34, 16, 12, center=False)
        self.text(f"TOPPINGS {sum(self.toppings)}/{len(self.toppings)}", 34, 230, 12, center=False)
        if self.lv["key"]:
            self.text("KEY: " + ("YES" if self.has_key else "NO"), 34, 470, 12, (255, 215, 0), center=False)
        x = 600
        for i, n in enumerate(POTIONS):
            pygame.draw.rect(self.screen, POTIONS[n], (x, 8, 14, 28), border_radius=4)
            t = self.p.potion_t[n]
            label = f"{i + 1}:x{self.p.inv[n]}" + (f" {t // FPS + 1}s" if t > 0 else "")
            self.text(label, 26, x + 20, 14, center=False)
            x += 120
        if self.escape:
            if self.escape_frames > 0:
                s = self.escape_frames / FPS
                col = (255, 80, 80) if s < 8 else (255, 230, 120)
                self.text(f"{s:05.2f}", 72, W // 2, 90, col)
            else:
                self.text("RUN!", 72, W // 2, 90, (255, 60, 60))
        if self.msg_t > 0:
            self.text(self.msg, 32, W // 2, H - 30)

    def draw_result(self):
        r = self.result
        if r["won"]:
            letter, _, pose, music, col = r["rank"]
            self.text("LEVEL COMPLETE!", 80, W // 2, 70, (255, 220, 60))
            self.text(letter, 260, W // 2 + 260, 230, col)
            self.draw_pose(letter, 200, 300)
            self.text(f"Pose: {pose}   |   Music: {music}", 26, W // 2, 440, (180, 180, 180))
            self.text(f"Score {r['score']}   (time bonus +{r['bonus']})", 40, W // 2 - 80, 140)
            self.text("NEW HIGH SCORE!" if self.new_best else f"High score: {r['best']}", 40,
                      W // 2 - 80, 185, (120, 255, 120) if self.new_best else (200, 200, 200))
        else:
            self.text("GAME OVER", 110, W // 2, 90, (255, 80, 80))
            self.text("Pizzaface got you!", 44, W // 2, 170)
            self.draw_pose("D", W // 2, 330, dead=True)
        for i, t in enumerate(["Retry", "Main Menu"]):
            on = i == self.sel
            self.text(("> " if on else "") + t, 44, W // 2, 470 + i * 42 - 20,
                      (255, 220, 60) if on else (230, 230, 230))

    def draw_pose(self, rank, x, y, dead=False):
        """Placeholder pose figure - replace with one sprite per rank."""
        body = (60, 120, 220)
        pygame.draw.rect(self.screen, body, (x - 20, y - 20, 40, 70))
        pygame.draw.rect(self.screen, (255, 255, 255), (x - 22, y - 36, 44, 18), border_radius=4)
        if dead:
            pygame.draw.line(self.screen, (255, 255, 255), (x - 40, y), (x - 20, y + 20), 6)
            pygame.draw.line(self.screen, (255, 255, 255), (x + 40, y), (x + 20, y + 20), 6)
        elif rank in ("S", "A"):   # arms up
            pygame.draw.line(self.screen, body, (x - 20, y - 5), (x - 45, y - 55), 8)
            pygame.draw.line(self.screen, body, (x + 20, y - 5), (x + 45, y - 55), 8)
        elif rank == "B":          # one thumb up
            pygame.draw.line(self.screen, body, (x + 20, y), (x + 50, y - 25), 8)
        else:                      # arms down
            pygame.draw.line(self.screen, body, (x - 20, y), (x - 38, y + 35), 8)
            pygame.draw.line(self.screen, body, (x + 20, y), (x + 38, y + 35), 8)


async def main():
    game = Game()
    running = True
    while running:
        for e in pygame.event.get():
            if e.type == pygame.QUIT:
                running = False
            else:
                game.handle(e)
        game.update()
        game.draw()
        pygame.display.flip()
        game.clock.tick(FPS)
        await asyncio.sleep(0)  # required so pygbag can yield to the browser
    pygame.quit()


asyncio.run(main())