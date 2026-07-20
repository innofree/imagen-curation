"""Qwen3-VL (abliterated / uncensored) evaluator.

Standalone loader that reuses the working inference pattern from ai-toolkit's
``extensions_built_in/captioner/Qwen3VLCaptioner.py`` (patch_embed speedup +
processor.apply_chat_template(tokenize=True) -> generate) without importing the
ai-toolkit job framework, so this package stays self-contained.
"""
from __future__ import annotations

import gc
from typing import Any, Dict, Optional

import torch
import torch.nn.functional as F
from PIL import Image

from .config import CurationConfig
from . import prompts


def _flush():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def patch_qwen_vl_patch_embed(model) -> int:
    """Swap the vision patch_embed Conv3d (kernel==stride) for an equivalent
    F.linear GEMM. bf16 Conv3d has no fast cuDNN kernel; this is a big speedup.
    Copied from ai-toolkit's Qwen3VLCaptioner. Returns #modules patched."""
    patched = 0
    for module in model.modules():
        proj = getattr(module, "proj", None)
        if isinstance(proj, torch.nn.Conv3d) and tuple(proj.kernel_size) == tuple(proj.stride):
            def fast_forward(hidden_states, _proj=proj):
                w = _proj.weight.reshape(_proj.weight.shape[0], -1)
                x = hidden_states.view(-1, w.shape[1]).to(w.dtype)
                return F.linear(x, w, _proj.bias)

            module.forward = fast_forward
            patched += 1
    return patched


_DTYPES = {"bf16": torch.bfloat16, "fp16": torch.float16, "float16": torch.float16,
           "bfloat16": torch.bfloat16, "fp32": torch.float32}


class VLEvaluator:
    def __init__(self, config: CurationConfig, log=print):
        self.cfg = config
        self.log = log
        self.model = None
        self.processor = None
        self.device = torch.device(config.device)
        self.torch_dtype = _DTYPES.get(config.dtype, torch.bfloat16)

    def load(self):
        from transformers import (
            AutoProcessor,
            Qwen3VLForConditionalGeneration,
            Qwen3VLMoeForConditionalGeneration,
        )

        path = self.cfg.model_name_or_path
        self.log(f"[vl] loading {path}")
        ModelClass = (
            Qwen3VLMoeForConditionalGeneration if "B-A" in path
            else Qwen3VLForConditionalGeneration
        )
        self.model = ModelClass.from_pretrained(
            path, dtype=self.torch_dtype, device_map="cpu"
        )
        n = patch_qwen_vl_patch_embed(self.model)
        self.log(f"[vl] patched {n} patch_embed module(s)")

        # Move to GPU first only when NOT low_vram and NOT quantizing (needs the
        # full bf16 model to fit). Otherwise quantize on CPU, then move the
        # smaller quantized model to the GPU (fits alongside other processes).
        move_before = not self.cfg.low_vram and not self.cfg.quantize
        if move_before:
            self.model.to(self.device)
        if self.cfg.quantize:
            from optimum.quanto import quantize as quanto_quantize, freeze, qfloat8, qint8
            qmap = {"float8": qfloat8, "int8": qint8}
            self.log(f"[vl] quantizing weights -> {self.cfg.qtype}")
            quanto_quantize(self.model, weights=qmap.get(self.cfg.qtype, qfloat8))
            freeze(self.model)
            _flush()
        self.processor = AutoProcessor.from_pretrained(path)
        if not move_before:
            self.model.to(self.device)
        self.model.eval()
        # greedy decoding: drop sampling params so transformers doesn't warn
        for attr in ("temperature", "top_p", "top_k"):
            if hasattr(self.model.generation_config, attr):
                setattr(self.model.generation_config, attr, None)
        _flush()
        self.log("[vl] model ready")

    def unload(self):
        self.model = None
        self.processor = None
        _flush()

    # -- generation ---------------------------------------------------------
    @torch.no_grad()
    def _generate(self, image: Image.Image, text: str, system: Optional[str],
                  max_new_tokens: int) -> str:
        content = [{"type": "image", "image": image}, {"type": "text", "text": text}]
        messages = []
        if system:
            messages.append({"role": "system", "content": [{"type": "text", "text": system}]})
        messages.append({"role": "user", "content": content})
        inputs = self.processor.apply_chat_template(
            messages, tokenize=True, add_generation_prompt=True,
            return_dict=True, return_tensors="pt",
        ).to(self.device)
        gen = self.model.generate(
            **inputs, max_new_tokens=max_new_tokens, do_sample=False,
        )
        trimmed = [out[len(inp):] for inp, out in zip(inputs.input_ids, gen)]
        out = self.processor.batch_decode(
            trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
        )
        return out[0].strip()

    def evaluate(self, image: Image.Image) -> Dict[str, Any]:
        """Return the normalized structured evaluation dict for one image.

        Retries once with a stricter nudge if JSON parsing fails; on repeated
        failure returns a conservative default flagged with parse_failed.
        """
        raw = self._generate(image, prompts.EVAL_USER, prompts.EVAL_SYSTEM,
                             self.cfg.vl_max_new_tokens)
        parsed = prompts.parse_eval(raw)
        if parsed is None:
            raw2 = self._generate(
                image,
                prompts.EVAL_USER + "\n\nIMPORTANT: output ONLY the JSON object.",
                prompts.EVAL_SYSTEM, self.cfg.vl_max_new_tokens,
            )
            parsed = prompts.parse_eval(raw2)
        if parsed is None:
            self.log("[vl] JSON parse failed; using neutral default")
            parsed = prompts.parse_eval("{}")
            parsed["parse_failed"] = True
            parsed["reason"] = "model output could not be parsed"
        return parsed

    def caption(self, image: Image.Image) -> str:
        return self._generate(image, prompts.CAPTION_USER, prompts.EVAL_SYSTEM,
                             self.cfg.vl_max_new_tokens)
