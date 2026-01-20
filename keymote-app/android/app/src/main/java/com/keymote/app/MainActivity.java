package com.keymote.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins before calling super.onCreate()
        registerPlugin(GalleryQrScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
