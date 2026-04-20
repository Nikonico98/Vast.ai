"""
rig_advisor.py — ChatGPT API 整合，提供自然語言骨骼調整建議。
使用 GPT-5.4 分析骨骼結構並產生調整指令。
"""

import json
from openai import OpenAI

from config import OPENAI_API_KEY, OPENAI_MODEL
from rig_schema import SYSTEM_PROMPT, RIG_INSTRUCTION_SCHEMA
from rig_postprocess import get_skeleton_info


class RigAdvisor:
    def __init__(self):
        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not set. Export it or add to .env file.")
        self.client = OpenAI(api_key=OPENAI_API_KEY)
        self.model = OPENAI_MODEL
        self.conversations = {}  # session_id -> message history

    def start_session(self, session_id: str, rig_data: dict) -> dict:
        """開始新的對話 session，分析骨骼結構。"""
        skeleton_info = get_skeleton_info(rig_data)
        model_info_str = json.dumps(skeleton_info, indent=2, ensure_ascii=False)

        self.conversations[session_id] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "system", "content": f"Current model skeleton info:\n```json\n{model_info_str}\n```"},
        ]
        return skeleton_info

    def chat(self, session_id: str, user_message: str) -> dict:
        """
        與 ChatGPT 對話，取得骨骼調整指令。

        Returns:
            dict with keys:
                - instructions: parsed RIG_INSTRUCTION_SCHEMA dict (or None if not applicable)
                - message: ChatGPT 的文字回覆
                - raw: 原始回覆內容
        """
        if session_id not in self.conversations:
            raise ValueError(f"Session {session_id} not found. Call start_session first.")

        history = self.conversations[session_id]
        history.append({"role": "user", "content": user_message})

        response = self.client.chat.completions.create(
            model=self.model,
            messages=history,
            temperature=0.3,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )

        reply = response.choices[0].message.content
        history.append({"role": "assistant", "content": reply})

        # Parse JSON instructions
        instructions = None
        message = reply
        try:
            parsed = json.loads(reply)
            if "explanation" in parsed:
                instructions = parsed
                message = parsed.get("explanation", reply)
        except json.JSONDecodeError:
            pass

        return {
            "instructions": instructions,
            "message": message,
            "raw": reply,
        }

    def update_model_info(self, session_id: str, rig_data: dict):
        """更新 session 中的模型資訊（在套用指令後）。"""
        if session_id not in self.conversations:
            return
        skeleton_info = get_skeleton_info(rig_data)
        model_info_str = json.dumps(skeleton_info, indent=2, ensure_ascii=False)
        self.conversations[session_id].append({
            "role": "system",
            "content": f"[Model updated] New skeleton info:\n```json\n{model_info_str}\n```"
        })

    def clear_session(self, session_id: str):
        """清除對話歷史。"""
        self.conversations.pop(session_id, None)

    def analyze_auto(self, rig_data: dict) -> dict:
        """
        一鍵自動分析：不需要對話，直接產生調整建議。

        Returns:
            dict matching RIG_INSTRUCTION_SCHEMA
        """
        skeleton_info = get_skeleton_info(rig_data)
        model_info_str = json.dumps(skeleton_info, indent=2, ensure_ascii=False)

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "system", "content": f"Current model skeleton info:\n```json\n{model_info_str}\n```"},
            {"role": "user", "content": (
                "請自動分析這個骨骼結構，找出需要優化的地方。"
                "包括：過近的骨骼合併、不必要的骨骼移除、位置調整、skinning 參數優化。"
                "同時提供語義化的骨骼分組。"
            )},
        ]

        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.3,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )

        reply = response.choices[0].message.content
        try:
            return json.loads(reply)
        except json.JSONDecodeError:
            return {"explanation": reply}
