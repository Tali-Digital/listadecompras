/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { Mic, Home, ShoppingCart, Trash2, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { db } from "./lib/firebase";
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  serverTimestamp 
} from "firebase/firestore";

type Tab = "em-casa" | "no-mercado";

interface ShoppingItem {
  id: string;
  name: string;
  createdAt: number;
  checked: boolean;
  price?: number;
}

declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("em-casa");
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
  const [isListeningPrice, setIsListeningPrice] = useState(false);
  const [priceModal, setPriceModal] = useState<{ isOpen: boolean; itemId: string | null; itemName: string }>({
    isOpen: false,
    itemId: null,
    itemName: ""
  });
  const [inputPrice, setInputPrice] = useState("");
  
  const recognitionRef = useRef<any>(null);
  const currentTranscriptRef = useRef<string>("");
  const isFinalizedRef = useRef<boolean>(false);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Sync from Firestore
  useEffect(() => {
    const q = query(collection(db, "shopping-list"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const itemsList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ShoppingItem[];
      setItems(itemsList);
    });
    
    return () => unsubscribe();
  }, []);

  const toggleVoiceRecognition = () => {
    if (isListening) {
      console.log("Parada manual solicitada.");
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          console.error("Erro ao parar:", e);
        }
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert("Seu navegador não suporta reconhecimento de voz.");
      return;
    }

    const newRecognition = new SpeechRecognition();
    recognitionRef.current = newRecognition;
    newRecognition.lang = "pt-BR";
    newRecognition.interimResults = true;
    newRecognition.maxAlternatives = 1;
    newRecognition.continuous = false;

    currentTranscriptRef.current = "";
    isFinalizedRef.current = false;

    newRecognition.onstart = () => {
      console.log("Iniciando escuta...");
      setIsListening(true);
    };

    newRecognition.onresult = (event: any) => {
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const finalPart = event.results[i][0].transcript.trim();
          if (finalPart !== "") {
            console.log("Parte final detectada:", finalPart);
            finalizeAndAdd(finalPart);
          }
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      
      if (interimTranscript.trim() !== "") {
        currentTranscriptRef.current = interimTranscript.trim();
        console.log("Transcrição temporária:", currentTranscriptRef.current);
      }
    };

    newRecognition.onerror = (event: any) => {
      console.error("Erro no reconhecimento:", event.error);
      if (event.error === 'not-allowed') {
        alert("Permissão de microfone negada. Verifique as configurações do navegador.");
      }
      setIsListening(false);
    };

    newRecognition.onend = () => {
      console.log("Evento onend disparado.");
      
      // Se parou e sobrou algo no buffer que não foi finalizado, adiciona agora
      if (!isFinalizedRef.current && currentTranscriptRef.current !== "") {
        console.log("Salvando buffer restante no fechamento:", currentTranscriptRef.current);
        finalizeAndAdd(currentTranscriptRef.current);
      }

      setIsListening(false);
      recognitionRef.current = null;
    };

    newRecognition.start();
  };

  const finalizeAndAdd = (text: string) => {
    if (isFinalizedRef.current) return;
    
    isFinalizedRef.current = true;
    
    // Limpeza básica: remover comandos comuns do início
    let cleanedName = text.trim().toLowerCase();
    const commands = ["comprar", "adicione", "adicionar", "quero", "bota", "coloca"];
    commands.forEach(cmd => {
      if (cleanedName.startsWith(cmd + " ")) {
        cleanedName = cleanedName.replace(cmd + " ", "");
      }
    });
    
    addItem(cleanedName);
    currentTranscriptRef.current = "";
  };

  const addItem = async (name: string) => {
    try {
      const nameCleaned = name.charAt(0).toUpperCase() + name.slice(1);
      await addDoc(collection(db, "shopping-list"), {
        name: nameCleaned,
        createdAt: Date.now(),
        checked: false,
      });
      
      setFeedback(nameCleaned);
      setTimeout(() => setFeedback(null), 3000);
    } catch (error) {
      console.error("Erro ao adicionar item:", error);
    }
  };

  const deleteItem = async (id: string) => {
    try {
      await deleteDoc(doc(db, "shopping-list", id));
    } catch (error) {
      console.error("Erro ao remover item:", error);
    }
  };

  const toggleItem = async (id: string, currentChecked: boolean, itemName: string) => {
    try {
      const { updateDoc, doc } = await import("firebase/firestore");
      
      if (!currentChecked) {
        // Se estiver marcando como concluído, abre o modal de preço
        setPriceModal({ isOpen: true, itemId: id, itemName });
        setInputPrice("");
      } else {
        // Se estiver desmarcando, apenas remove o status de checked e o preço (opcional)
        await updateDoc(doc(db, "shopping-list", id), {
          checked: false
        });
      }
    } catch (error) {
      console.error("Erro ao atualizar item:", error);
    }
  };

  const handleSavePrice = async () => {
    if (!priceModal.itemId) return;
    
    try {
      const { updateDoc, doc } = await import("firebase/firestore");
      // Remove R$, espaços e troca vírgula por ponto
      const cleanValue = inputPrice.replace(/[R$\s]/g, "").replace(",", ".");
      const priceValue = parseFloat(cleanValue);
      
      await updateDoc(doc(db, "shopping-list", priceModal.itemId), {
        checked: true,
        price: isNaN(priceValue) ? 0 : priceValue
      });
      
      setPriceModal({ isOpen: false, itemId: null, itemName: "" });
      setInputPrice("");
    } catch (error) {
      console.error("Erro ao salvar preço:", error);
    }
  };

  const toggleVoicePriceRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert("Seu navegador não suporta reconhecimento de voz.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    
    recognition.onstart = () => setIsListeningPrice(true);
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      let numericValue = transcript.replace(/[^0-9,.]/g, "");
      
      if (!numericValue) {
        const words = transcript.toLowerCase();
        if (words.includes(" e ")) {
          const parts = words.split(" e ");
          const main = parts[0].replace(/[^0-9]/g, "");
          const cents = parts[1].replace(/[^0-9]/g, "");
          if (main && cents) numericValue = `${main},${cents}`;
        }
      }

      if (numericValue) {
        setInputPrice(numericValue);
        // Pequeno delay para o usuário ver o valor preenchido antes de fechar
        setTimeout(() => {
          autoSavePrice(numericValue);
        }, 500);
      }
    };

    recognition.onerror = () => setIsListeningPrice(false);
    recognition.onend = () => setIsListeningPrice(false);
    
    recognition.start();
  };

  const autoSavePrice = async (value: string) => {
    if (!priceModal.itemId) return;
    
    try {
      const { updateDoc, doc } = await import("firebase/firestore");
      const cleanValue = value.replace(/[R$\s]/g, "").replace(",", ".");
      const priceValue = parseFloat(cleanValue);
      
      await updateDoc(doc(db, "shopping-list", priceModal.itemId), {
        checked: true,
        price: isNaN(priceValue) ? 0 : priceValue
      });
      
      setPriceModal({ isOpen: false, itemId: null, itemName: "" });
      setInputPrice("");
    } catch (error) {
      console.error("Erro ao salvar automaticamente:", error);
    }
  };

  // Shared Voice UI component
  const VoiceSection = () => (
    <div className="h-full flex flex-col items-center justify-center px-6 py-4 relative overflow-y-auto custom-scrollbar">
      {/* Success Feedback Toast */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-4 bg-green-500 text-white px-6 py-3 rounded-full flex items-center gap-2 shadow-lg z-20 whitespace-nowrap"
          >
            <CheckCircle2 size={18} />
            <span className="text-xs font-bold uppercase tracking-wide">{feedback} adicionado!</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="text-center mb-10 md:mb-16">
        <h2 className="text-2xl md:text-3xl font-black text-slate-800 mb-2 md:mb-3 uppercase tracking-tight">O que falta aí?</h2>
        <p className="text-slate-500 text-sm md:text-base leading-relaxed opacity-80 max-w-sm mx-auto">
          Toque no microfone e diga os itens que você precisa para o seu carrinho.
        </p>
      </div>

      <div className="relative">
        <motion.div
          animate={{ 
            scale: isListening ? [1, 1.6, 1] : [1, 1.3, 1], 
            opacity: isListening ? [0.3, 0, 0.3] : [0.2, 0, 0.2] 
          }}
          transition={{ duration: isListening ? 1.5 : 2.5, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute -inset-10 md:-inset-14 ${isListening ? 'bg-primary/30' : 'bg-primary/10'} rounded-full blur-2xl`}
        />
        <motion.div
          animate={{ 
            scale: isListening ? [1, 1.3, 1] : [1, 1.1, 1], 
            opacity: isListening ? [0.4, 0.1, 0.4] : [0.3, 0.1, 0.3] 
          }}
          transition={{ duration: isListening ? 1 : 2, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute -inset-6 md:-inset-8 ${isListening ? 'bg-primary/40' : 'bg-primary/20'} rounded-full blur-xl`}
        />
        
        <motion.button
          onClick={toggleVoiceRecognition}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={`relative z-10 w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center shadow-[0_20px_40px_rgba(255,215,0,0.3)] transition-all duration-300 ${
            isListening ? 'bg-red-600 text-white scale-110' : 'bg-yellow-400 text-slate-900 hover:bg-yellow-500'
          }`}
        >
          <Mic size={isDesktop ? 64 : 52} strokeWidth={2.5} className={isListening ? "animate-pulse" : ""} />
        </motion.button>
      </div>

      <div className={`mt-12 md:mt-20 font-black text-xs md:text-sm uppercase tracking-[0.3em] transition-colors ${
        isListening ? 'text-primary animate-pulse' : 'text-slate-300'
      }`}>
        {isListening ? "Ouvindo..." : '"1kg de café..."'}
      </div>

      {/* Manual Input Fallback */}
      {!isListening && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-6 md:mt-8 flex gap-2 w-full max-w-xs"
        >
          <input 
            type="text" 
            placeholder="Ou digite aqui..."
            className="flex-1 bg-slate-100 border-none rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.target as HTMLInputElement).value) {
                addItem((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).value = "";
              }
            }}
          />
        </motion.div>
      )}
    </div>
  );

  // Shared List UI component
  const ListSection = () => (
    <div className="h-full flex flex-col p-6 md:p-12 overflow-hidden">
      <div className="mb-6 md:mb-8 flex justify-between items-end flex-shrink-0">
        <div>
          <h2 className="text-2xl md:text-3xl font-black text-slate-800 uppercase tracking-tight">Minha Lista</h2>
          <p className="text-slate-500 text-xs md:text-sm font-medium mt-1">Prontos para o carrinho.</p>
        </div>
        <div className="text-primary font-black text-base md:text-lg bg-primary/10 w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-2xl">
          {items.length}
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto pr-1 -mr-1 custom-scrollbar">
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center border-2 border-dashed border-slate-100 rounded-[32px] md:rounded-[40px] bg-slate-50/50 p-6 md:p-10 text-center">
            <div>
              <div className="w-16 h-16 md:w-20 md:h-20 bg-white rounded-3xl flex items-center justify-center mb-6 mx-auto shadow-sm">
                <ShoppingCart size={32} className="text-slate-200" />
              </div>
              <p className="text-sm md:text-lg font-bold text-slate-400 uppercase tracking-widest">
                Sua lista está vazia
              </p>
              <p className="text-[10px] md:text-sm text-slate-400 opacity-60 mt-2 max-w-[200px] mx-auto uppercase tracking-wider font-semibold">
                {isDesktop ? "Fale um item ao lado para começar." : "Fale um item na aba 'Em Casa'."}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 md:gap-4 pb-8">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className={`bg-white border p-4 md:p-5 rounded-[20px] md:rounded-[24px] shadow-[0_4px_12px_rgba(0,0,0,0.02)] flex items-center justify-between group transition-all duration-300 ${
                    item.checked ? 'border-green-100 bg-green-50/30' : 'border-slate-100 hover:border-primary/30 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-center gap-3 md:gap-4 flex-1">
                    <button 
                      onClick={() => toggleItem(item.id, item.checked, item.name)}
                      className={`w-6 h-6 md:w-7 md:h-7 rounded-lg border-2 flex items-center justify-center transition-all ${
                        item.checked ? 'bg-green-500 border-green-500 text-white' : 'border-slate-200 text-transparent hover:border-primary'
                      }`}
                    >
                      <CheckCircle2 size={18} />
                    </button>
                    <div className="flex flex-col">
                      <span className={`font-bold text-base md:text-lg transition-all ${
                        item.checked ? 'text-green-600/50 line-through' : 'text-slate-700'
                      }`}>
                        {item.name}
                      </span>
                      {item.checked && item.price !== undefined && (
                        <span className="text-xs font-bold text-green-600">
                          R$ {item.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteItem(item.id)}
                    className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center text-slate-200 hover:text-red-500 hover:bg-red-50 transition-all duration-300"
                    title="Remover"
                  >
                    <Trash2 size={isDesktop ? 22 : 18} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Total do Carrinho */}
      {items.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
          <span className="text-xs font-black uppercase tracking-widest text-slate-400">Total do Carrinho</span>
          <span className="text-2xl font-black text-primary">
            R$ {items.reduce((acc, item) => acc + (item.checked ? (item.price || 0) : 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-0 md:p-8 font-sans">
      <div className={isDesktop ? "desktop-layout" : "app-container"}>
        
        {/* Desktop View: Split Layout */}
        {isDesktop ? (
          <>
            {/* Left Sidebar / Control Panel */}
            <div className="w-[45%] border-r border-slate-100 flex flex-col bg-white">
              <header className="px-10 py-10 flex items-center gap-3">
                <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white">
                  <Mic size={24} strokeWidth={3} />
                </div>
                <h1 className="text-2xl font-display font-black text-primary tracking-tighter uppercase">
                  Voice<span className="text-slate-900">Shop</span>
                </h1>
              </header>
              <div className="flex-1">
                <VoiceSection />
              </div>
              <footer className="px-10 py-8 text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">
                Desktop Mode active // Voice Enabled
              </footer>
            </div>

            {/* Right Side: List Content */}
            <div className="flex-1 bg-slate-50/30">
              <ListSection />
            </div>
          </>
        ) : (
          /* Mobile View: Tabbed Layout */
          <>
            {/* Status Bar Simulation - Optional but smaller if kept */}
            <div className="h-8 w-full px-8 flex justify-between items-center text-[11px] font-semibold text-slate-400 shrink-0">
              <span>9:41</span>
              <div className="flex gap-1 pt-0.5">
                <div className="w-3 h-3 bg-slate-200 rounded-full flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                </div>
                <div className="w-3 h-3 bg-slate-200 rounded-full"></div>
              </div>
            </div>

            {/* Header */}
            <header className="px-6 py-3 flex justify-center items-center border-b border-slate-50 shrink-0">
              <h1 className="text-lg font-display font-black text-primary tracking-tight uppercase">
                Voice<span className="text-slate-900">Shop</span>
              </h1>
            </header>

            {/* Content Area */}
            <main className="flex-1 relative overflow-hidden">
              <AnimatePresence mode="wait">
                {activeTab === "em-casa" ? (
                  <motion.div
                    key="em-casa"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full"
                  >
                    <VoiceSection />
                  </motion.div>
                ) : (
                  <motion.div
                    key="no-mercado"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full"
                  >
                    <ListSection />
                  </motion.div>
                )}
              </AnimatePresence>
            </main>

            {/* Bottom Navigation */}
            <nav className="h-20 bg-white border-t border-slate-50 flex items-center justify-around px-8 pb-4 relative shrink-0">
              <button
                onClick={() => setActiveTab("em-casa")}
                className="flex flex-col items-center gap-1 group"
              >
                <div className={`w-12 h-7 rounded-full flex items-center justify-center transition-all ${
                  activeTab === "em-casa" ? "bg-primary text-white" : "bg-transparent text-slate-300"
                }`}>
                  <Home size={20} strokeWidth={2.5} />
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-wider ${
                  activeTab === "em-casa" ? "text-primary" : "text-slate-300"
                }`}>Em Casa</span>
              </button>

              <button
                onClick={() => setActiveTab("no-mercado")}
                className="flex flex-col items-center gap-1 group"
              >
                <div className={`w-12 h-7 rounded-full flex items-center justify-center transition-all ${
                  activeTab === "no-mercado" ? "bg-primary text-white" : "bg-transparent text-slate-300"
                }`}>
                  <div className="relative">
                    <ShoppingCart size={20} strokeWidth={2.5} />
                    {items.length > 0 && (
                      <span className="absolute -top-1.5 -right-2 w-3.5 h-3.5 bg-primary text-[7px] flex items-center justify-center rounded-full border-2 border-white font-black text-white">
                        {items.length}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-wider ${
                  activeTab === "no-mercado" ? "text-primary" : "text-slate-300"
                }`}>No Mercado</span>
              </button>
              
              {/* Home Indicator */}
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-24 h-1 bg-slate-50 rounded-full"></div>
            </nav>
          </>
        )}
      </div>

      {/* Modal de Preço */}
      <AnimatePresence>
        {priceModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[32px] p-8 w-full max-w-sm shadow-2xl"
            >
              <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight mb-2">Quanto custou?</h3>
              <p className="text-slate-500 text-sm mb-6">Digite o valor de <strong>{priceModal.itemName}</strong></p>
              
              <div className="relative mb-6 flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">R$</span>
                  <input
                    autoFocus
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={inputPrice}
                    onChange={(e) => setInputPrice(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSavePrice()}
                    className="w-full bg-slate-100 border-none rounded-2xl py-4 pl-12 pr-4 text-xl font-bold text-slate-700 focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <button
                  onClick={toggleVoicePriceRecognition}
                  className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${
                    isListeningPrice ? 'bg-red-500 text-white animate-pulse' : 'bg-yellow-400 text-slate-900 hover:bg-yellow-500'
                  }`}
                >
                  <Mic size={24} />
                </button>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setPriceModal({ isOpen: false, itemId: null, itemName: "" })}
                  className="flex-1 py-4 rounded-2xl font-bold text-slate-400 hover:bg-slate-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSavePrice}
                  className="flex-1 py-4 bg-primary text-white rounded-2xl font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
                >
                  Salvar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
